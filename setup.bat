@echo off
echo ================================
echo   Nuxt 4 AI Reading - 项目安装
echo ================================
echo.

cd /d "%~dp0"

echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo 安装失败，请检查 Node.js 是否已安装（需要 >= 18.20）
    pause
    exit /b 1
)

echo.
echo [2/3] 配置 API Key...
if not exist .env (
    echo 请创建 .env 文件并填入你的 DeepSeek API Key
) else (
    echo .env 文件已存在
    echo 请确认 DEEPSEEK_API_KEY 已正确配置
)

echo.
echo [3/3] 启动开发服务器...
echo.
echo 运行: npm run dev
echo 然后打开浏览器访问 http://localhost:3000
echo.
pause
