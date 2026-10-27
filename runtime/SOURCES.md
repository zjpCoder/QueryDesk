# JDBC 运行环境来源

- Oracle ojdbc8 19.25.0.0：Maven Central `com.oracle.database.jdbc:ojdbc8:19.25.0.0`。分发许可全文见 `jdbc/ORACLE-LICENSE.txt`。
- Gson 2.11.0：Maven Central `com.google.code.gson:gson:2.11.0`。Apache-2.0 许可见 `jdbc/GSON-LICENSE.txt`；源码 https://github.com/google/gson/tree/gson-parent-2.11.0 。
- Eclipse Temurin JRE 17.0.20.1+1 Windows x64：GPLv2 with Classpath Exception，完整许可保留在 `java/legal` 与 Java 自带的说明文件。
  - 二进制及对应源代码发行文件：https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1
  - OpenJDK 源码仓库：https://github.com/adoptium/jdk17u

固定下载地址和 SHA256 位于 `manifest.json`。安装包包含运行时；源码压缩包通过 `npm run setup:jdbc` 重建运行时，再以 JDK 编译本项目的 Java 桥接源码。
