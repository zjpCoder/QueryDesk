import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** Private stdin/stdout protocol. Never writes SQL, credentials or rows to logs. */
public final class QueryDeskBridge {
    static final Gson JSON = new GsonBuilder().serializeNulls().disableHtmlEscaping().create();
    static final Map<String, Session> SESSIONS = new ConcurrentHashMap<>();
    static final ExecutorService WORK = Executors.newFixedThreadPool(16);
    static final ExecutorService CONTROL = Executors.newFixedThreadPool(2);
    static final PrintWriter OUT = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
    static class Session {
        final Connection connection;
        final Map<String, Cursor> cursors = new HashMap<>();
        final AtomicLong cancellation = new AtomicLong();
        volatile Statement active;
        Session(Connection c) { connection = c; }
    }
    static class Cursor {
        final PreparedStatement statement;
        final ResultSet rows;
        final List<Map<String, String>> metadata;
        final boolean commit;
        Cursor(PreparedStatement s, ResultSet r, boolean a) throws SQLException {
            statement = s; rows = r; commit = a; metadata = columns(r);
        }
    }
    static String str(JsonObject p, String name) { return p.has(name) && !p.get(name).isJsonNull() ? p.get(name).getAsString() : ""; }
    static boolean bool(JsonObject p, String name) { return p.has(name) && p.get(name).getAsBoolean(); }
    static List<Map<String,String>> columns(ResultSet rs) throws SQLException {
        List<Map<String,String>> result = new ArrayList<>();
        ResultSetMetaData m = rs.getMetaData();
        for (int i=1; i<=m.getColumnCount(); i++) result.add(Map.of("name", m.getColumnLabel(i)));
        return result;
    }
    static Object value(ResultSet rs, ResultSetMetaData m, int i) throws Exception {
        int type = m.getColumnType(i);
        if (type == Types.BLOB || type == Types.CLOB || type == Types.NCLOB || type == Types.SQLXML) {
            Object lob = rs.getObject(i);
            if (lob == null) return null;
            if (lob instanceof Blob) ((Blob)lob).free();
            if (lob instanceof Clob) ((Clob)lob).free();
            if (lob instanceof SQLXML) ((SQLXML)lob).free();
            return "[LOB：请使用 SQL 截取查看]";
        }
        if (type == Types.BINARY || type == Types.VARBINARY || type == Types.LONGVARBINARY) {
            try (InputStream input = rs.getBinaryStream(i)) {
                if (input == null) return null;
                byte[] bytes = input.readNBytes(65537);
                return "[二进制 " + (bytes.length > 65536 ? "超过 65536" : bytes.length) + " 字节]";
            }
        }
        // Character streams bound LONG/string allocations. Numbers remain decimal strings.
        if (type == Types.LONGVARCHAR || type == Types.LONGNVARCHAR || type == Types.VARCHAR || type == Types.NVARCHAR || type == Types.CHAR || type == Types.NCHAR) {
            try (Reader reader = rs.getCharacterStream(i)) {
                if (reader == null) return null;
                char[] chars = new char[65537]; int used=0, n;
                while (used < chars.length && (n=reader.read(chars, used, chars.length-used)) != -1) used += n;
                return new String(chars,0,Math.min(used,65536)) + (used>65536 ? "[内容已截断]" : "");
            }
        }
        if (type == Types.NUMERIC || type == Types.DECIMAL || type == Types.BIGINT || type == Types.INTEGER || type == Types.SMALLINT) {
            java.math.BigDecimal n = rs.getBigDecimal(i); if(n==null)return null;
            int scale=m.getScale(i);if(scale>=0 && scale<=127 && n.scale()<scale)n=n.setScale(scale);
            return n.toPlainString();
        }
        if (type == Types.DATE || type == Types.TIMESTAMP) {
            Timestamp t=rs.getTimestamp(i); if(t==null)return null;
            String text=t.toString();
            return "DATE".equalsIgnoreCase(m.getColumnTypeName(i)) ? text.substring(0,19) : text;
        }
        if (type == Types.STRUCT || type == Types.ARRAY || type == Types.REF || type == Types.JAVA_OBJECT) {
            return rs.getObject(i) == null ? null : "[复杂类型：请使用 SQL 转换查看]";
        }
        String text = rs.getString(i);
        return text != null && text.length()>65536 ? text.substring(0,65536)+"[内容已截断]" : text;
    }
    static List<List<Object>> rows(ResultSet rs, int count, long byteLimit) throws Exception {
        List<List<Object>> result=new ArrayList<>(); ResultSetMetaData meta=rs.getMetaData(); long size=0;
        while(result.size()<count && rs.next()) {
            List<Object> row=new ArrayList<>();
            for(int i=1;i<=meta.getColumnCount();i++) row.add(value(rs,meta,i));
            size += JSON.toJson(row).getBytes(StandardCharsets.UTF_8).length;
            if(size>byteLimit) throw new SQLException("结果批次超过 32 MiB，请减少字段或截取大字段");
            result.add(row);
        }
        return result;
    }
    static void checkCancel(Session s,long generation) throws SQLException {
        if(s.cancellation.get()!=generation) throw new SQLException("ORA-01013: 查询已取消", "72000",1013);
    }
    static Object execute(Session s,JsonObject p) throws Exception {
        long generation=s.cancellation.get();
        PreparedStatement statement=s.connection.prepareStatement(str(p,"sql"));
        s.active=statement; boolean retained=false;
        try {
            statement.setFetchSize(200);
            JsonArray binds=p.getAsJsonArray("binds");
            for(int i=0;i<binds.size();i++) {
                JsonElement v=binds.get(i);
                if(v.isJsonNull()) statement.setNull(i+1,Types.VARCHAR);
                else if(v.getAsJsonPrimitive().isBoolean()) statement.setInt(i+1,v.getAsBoolean()?1:0);
                else if(v.getAsJsonPrimitive().isNumber()) statement.setBigDecimal(i+1,v.getAsBigDecimal());
                else statement.setString(i+1,v.getAsString());
            }
            checkCancel(s,generation);
            boolean query=statement.execute(); checkCancel(s,generation);
            if(query) {
                ResultSet rs=statement.getResultSet();
                if(bool(p,"resultSet")) {
                    String id=UUID.randomUUID().toString(); Cursor cursor=new Cursor(statement,rs,bool(p,"autoCommit"));
                    s.cursors.put(id,cursor); retained=true;
                    return Map.of("cursor",id,"metaData",cursor.metadata);
                }
                List<Map<String,String>> names=columns(rs);
                List<List<Object>> data=rows(rs,10001,32*1024*1024);
                if(data.size()>10000) throw new SQLException("元数据结果超过 10,000 行，请缩小范围");
                List<Map<String,Object>> mapped=new ArrayList<>();
                for(List<Object> row:data) { Map<String,Object> item=new LinkedHashMap<>(); for(int i=0;i<names.size();i++)item.put(names.get(i).get("name"),row.get(i)); mapped.add(item); }
                return Map.of("rows",mapped);
            }
            if(bool(p,"autoCommit")) s.connection.commit();
            return Map.of("rowsAffected",Math.max(0,statement.getUpdateCount()));
        } catch(Exception e) {
            if(bool(p,"autoCommit"))try{s.connection.rollback();}catch(SQLException rollback){e.addSuppressed(rollback);}
            throw e;
        } finally { s.active=null; if(!retained)statement.close(); }
    }
    static Object handle(JsonObject p) throws Exception {
        String method=str(p,"method");
        if(method.equals("inspect")) return Map.of("message","Oracle JDBC Thin · 内置 Java "+System.getProperty("java.version")+" · 驱动 "+new oracle.jdbc.OracleDriver().getDriverVersion(),"pid",ProcessHandle.current().pid(),"runtime",System.getProperty("java.home"));
        if(method.equals("connect")) {
            Properties properties=new Properties(); properties.setProperty("user",str(p,"user")); properties.setProperty("password",str(p,"password"));
            properties.setProperty("oracle.net.CONNECT_TIMEOUT","12000"); properties.setProperty("oracle.net.OUTBOUND_CONNECT_TIMEOUT","12000");
            properties.setProperty("oracle.jdbc.ReadTimeout","300000");
            properties.setProperty("oracle.jdbc.defaultLobPrefetchSize","0");
            Connection c=DriverManager.getConnection("jdbc:oracle:thin:@"+str(p,"connectString"),properties);
            try { c.setAutoCommit(false); String id=UUID.randomUUID().toString(); String version=c.getMetaData().getDatabaseProductVersion(); SESSIONS.put(id,new Session(c)); return Map.of("session",id,"version",version); }
            catch(Exception e) {c.close();throw e;}
        }
        Session s=SESSIONS.get(str(p,"session")); if(s==null)throw new SQLException("JDBC 会话已关闭，请重新连接");
        if(method.equals("cancel")) { s.cancellation.incrementAndGet(); Statement active=s.active; if(active!=null)active.cancel(); return null; }
        synchronized(s) {
            switch(method) {
                case "execute": return execute(s,p);
                case "fetch": {
                    Cursor cursor=s.cursors.get(str(p,"cursor")); if(cursor==null)throw new SQLException("结果游标已关闭");
                    long generation=s.cancellation.get();s.active=cursor.statement;
                    try {List<List<Object>> result=rows(cursor.rows,Math.min(200,p.get("count").getAsInt()),32*1024*1024);checkCancel(s,generation);return result;} finally{s.active=null;}
                }
                case "cursor.close": {
                    Cursor cursor=s.cursors.remove(str(p,"cursor"));
                    if(cursor!=null) {try{cursor.statement.close();}finally{if(cursor.commit)s.connection.commit();}}return null;
                }
                case "commit": s.connection.commit();return null;
                case "rollback": s.connection.rollback();return null;
                case "close": SESSIONS.remove(str(p,"session")); try{s.connection.rollback();}finally{s.connection.close();}return null;
                default: throw new IllegalArgumentException("未知 JDBC 操作");
            }
        }
    }
    static void respond(JsonObject request) {
        Map<String,Object> response=new LinkedHashMap<>(); response.put("id",str(request,"id"));
        try {response.put("value",handle(request));response.put("ok",true);}
        catch(Throwable e) {
            String message=e instanceof SQLException ? "JDBC "+((SQLException)e).getErrorCode()+": "+e.getMessage() : e instanceof OutOfMemoryError ? "JDBC 内存不足，请重新连接并缩小结果范围" : e.getMessage();
            if(message==null)message="JDBC 操作失败";
            String password=str(request,"password");if(!password.isEmpty())message=message.replace(password,"[已隐藏]");
            response.put("ok",false);response.put("error",message.substring(0,Math.min(message.length(),4000)));
        }
        synchronized(OUT){OUT.println(JSON.toJson(response));}
    }
    public static void main(String[] args) throws Exception {
        Class.forName("oracle.jdbc.OracleDriver");
        long parent=Long.parseLong(args[0]);
        Thread watchdog=new Thread(()->{try{while(ProcessHandle.of(parent).map(ProcessHandle::isAlive).orElse(false))Thread.sleep(2000);}catch(InterruptedException ignored){}System.exit(0);});
        watchdog.setDaemon(true);watchdog.start();
        try(BufferedReader reader=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8))) {
            String line;while((line=reader.readLine())!=null) {
                JsonObject request=JsonParser.parseString(line).getAsJsonObject();
                (str(request,"method").equals("cancel")?CONTROL:WORK).execute(()->respond(request));
            }
        } finally {System.exit(0);}
    }
}
