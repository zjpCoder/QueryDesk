import java.sql.*;
import java.util.*;

// 保留既有 Cursor 的二进制接口，只补充 JDBC 本来就提供的结果字段类型。
class QueryDeskBridge$Cursor {
    final PreparedStatement statement;
    final ResultSet rows;
    final List<Map<String, String>> metadata;
    final boolean commit;

    QueryDeskBridge$Cursor(PreparedStatement statement, ResultSet rows, boolean commit) throws SQLException {
        this.statement = statement;
        this.rows = rows;
        this.commit = commit;
        this.metadata = new ArrayList<>();
        ResultSetMetaData info = rows.getMetaData();
        for (int i = 1; i <= info.getColumnCount(); i++) {
            String type = info.getColumnTypeName(i);
            int jdbcType = info.getColumnType(i), precision = info.getPrecision(i), scale = info.getScale(i);
            if (precision > 0 && Arrays.asList(Types.CHAR, Types.VARCHAR, Types.NCHAR, Types.NVARCHAR, Types.BINARY, Types.VARBINARY).contains(jdbcType)) type += "(" + precision + ")";
            else if (precision > 0 && (jdbcType == Types.NUMERIC || jdbcType == Types.DECIMAL)) type += "(" + precision + "," + scale + ")";
            metadata.add(Map.of("name", info.getColumnLabel(i), "type", type));
        }
    }
}
