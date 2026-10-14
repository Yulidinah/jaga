@echo off
setlocal
set APP_HOME=%~dp0
if not defined GRADLE_USER_HOME set GRADLE_USER_HOME=%APP_HOME%.gradle-user-home
if defined JAVA_HOME (
  set JAVA_EXE=%JAVA_HOME%\bin\java.exe
) else (
  set JAVA_EXE=java.exe
)
"%JAVA_EXE%" -classpath "%APP_HOME%gradle\wrapper\gradle-wrapper.jar;%APP_HOME%gradle\wrapper\gradle-wrapper-shared.jar;%APP_HOME%gradle\wrapper\gradle-cli.jar;%APP_HOME%gradle\wrapper\gradle-files.jar" org.gradle.wrapper.GradleWrapperMain %*
endlocal
