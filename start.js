const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createProxyMiddleware } = require('http-proxy-middleware');

// --- 1. 配置和常量 ---
const PUBLIC_PORT = 8100;
const APP_INTERNAL_PORT = 3000; // server.js (主应用) 固定监听的内部端口

const MASTER_PASSWORD_STORAGE_FILE = path.join(__dirname, 'master_auth_config.enc');
const USER_CREDENTIALS_STORAGE_FILE = path.join(__dirname, 'user_credentials.enc');
const MASTER_SECRET_KEY_FILE = path.join(__dirname, 'encryption.secret.key');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

let serverJsProcess = null;

// --- 1a. 获取或生成主加密密钥文本 ---
function initializeEncryptionSecretKeyText() {
    if (fs.existsSync(MASTER_SECRET_KEY_FILE)) {
        console.log(`[AUTH_GATE] 应用提示：正在从 ${MASTER_SECRET_KEY_FILE} 读取主加密密钥...`);
        const keyText = fs.readFileSync(MASTER_SECRET_KEY_FILE, 'utf8').trim();
        if (keyText.length < 64) {
            console.warn(`[AUTH_GATE] 安全警告：${MASTER_SECRET_KEY_FILE} 中的密钥文本长度 (${keyText.length}) 可能不足。建议使用更长的密钥。`);
        }
        return keyText;
    } else {
        console.log(`[AUTH_GATE] 应用提示：主加密密钥文件 ${MASTER_SECRET_KEY_FILE} 不存在。正在生成新密钥...`);
        const newKeyText = crypto.randomBytes(48).toString('hex'); // 生成96个十六进制字符
        try {
            fs.writeFileSync(MASTER_SECRET_KEY_FILE, newKeyText, { encoding: 'utf8', mode: 0o600 });
            fs.chmodSync(MASTER_SECRET_KEY_FILE, 0o600); // Ensure permissions
            console.log(`[AUTH_GATE] 应用提示：新的主加密密钥已生成并保存到 ${MASTER_SECRET_KEY_FILE} (权限 600)。`);
            console.warn(`[AUTH_GATE] 重要：请务必安全备份 ${MASTER_SECRET_KEY_FILE} 文件！删除此文件将导致所有已加密密码无法解密。`);
            return newKeyText;
        } catch (err) {
            console.error(`[AUTH_GATE] 严重错误：无法写入或设置主加密密钥文件 ${MASTER_SECRET_KEY_FILE} 的权限。程序将退出。`, err);
            process.exit(1);
        }
    }
}

const ENCRYPTION_SECRET_KEY_TEXT = initializeEncryptionSecretKeyText();
// 使用scrypt派生密钥以增强安全性
const DERIVED_ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_SECRET_KEY_TEXT, 'a_fixed_salt_for_scrypt_derivation_v1_auth_gate', 32); // 盐值最好是随机生成并存储的，但为了简化示例，这里用固定的

let isMasterPasswordSetupNeeded = !fs.existsSync(MASTER_PASSWORD_STORAGE_FILE);

// --- 1b. 启动和管理 server.js (主应用) ---
function startMainApp() {
    if (serverJsProcess && !serverJsProcess.killed) {
        console.log('[AUTH_GATE] 主应用 (server.js) 已在运行中或正在尝试启动。');
        return;
    }
    console.log(`[AUTH_GATE] 尝试启动主应用 (server.js)，该应用应固定监听端口 ${APP_INTERNAL_PORT}...`);
    const mainAppPath = path.join(__dirname, 'server.js'); // 假设主应用 server.js 在同一目录

    if (!fs.existsSync(mainAppPath)) {
        console.error(`[AUTH_GATE] 严重错误：主应用文件 ${mainAppPath} 未找到。请确保路径正确。`);
        return;
    }

    // 传递主应用需要监听的端口作为环境变量
    const mainAppEnv = { ...process.env, PORT: APP_INTERNAL_PORT.toString(), NOTEPAD_PORT: APP_INTERNAL_PORT.toString() };
    const options = { stdio: 'inherit', env: mainAppEnv };

    serverJsProcess = spawn(process.execPath, [mainAppPath], options); // 使用 process.execPath (node)

    serverJsProcess.on('error', (err) => {
        console.error(`[AUTH_GATE] 启动主应用 (server.js) 失败: ${err.message}`);
        serverJsProcess = null;
    });

    serverJsProcess.on('exit', (code, signal) => {
        const reason = code !== null ? `退出码 ${code}` : (signal ? `信号 ${signal}` : '未知原因');
        console.log(`[AUTH_GATE] 主应用 (server.js) 已退出 (${reason})。`);
        serverJsProcess = null;
        // 可选：尝试重启主应用
        // if (!isShuttingDown) { // 避免在正常关闭时重启
        //     console.log('[AUTH_GATE] 尝试在5秒后重启主应用...');
        //     setTimeout(startMainApp, 5000);
        // }
    });

    if (serverJsProcess && serverJsProcess.pid) {
        console.log(`[AUTH_GATE] 主应用 (server.js) 进程已启动，PID: ${serverJsProcess.pid}，监听内部端口 ${APP_INTERNAL_PORT}`);
    } else {
        console.error(`[AUTH_GATE] 主应用 (server.js) 未能立即获取PID，可能启动失败。请检查 ${mainAppPath} 是否可执行以及是否有错误输出。`);
        serverJsProcess = null;
    }
}
let isShuttingDown = false; // 用于优雅关闭时避免重启子进程

// --- 2. 加密与解密函数 ---
function encryptUserPassword(text) {
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, DERIVED_ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error("[AUTH_GATE] 数据加密函数内部错误:", error);
        throw new Error("Data encryption failed.");
    }
}

function decryptUserPassword(text) {
    try {
        const parts = text.split(':');
        if (parts.length !== 2) {
            console.error("[AUTH_GATE] 数据解密失败：密文格式无效（缺少IV）。密文:", text.substring(0, 20) + "...");
            return null;
        }
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = parts.join(':'); // 确保如果原始文本中包含':'，也能正确处理
        const decipher = crypto.createDecipheriv(ALGORITHM, DERIVED_ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        // 常见错误如 "Error: Invalid IV length" 或 "Error: error:06065064:digital envelope routines:EVP_DecryptFinal_ex:bad decrypt"
        console.error("[AUTH_GATE] 数据解密函数内部错误:", error.message, "密文:", text.substring(0,20) + "...");
        return null;
    }
}

// --- 2b. User Credentials Management ---
function readUserCredentials() {
    if (!fs.existsSync(USER_CREDENTIALS_STORAGE_FILE)) {
        return {};
    }
    try {
        const encryptedData = fs.readFileSync(USER_CREDENTIALS_STORAGE_FILE, 'utf8');
        if (!encryptedData.trim()) return {}; // 空文件
        const decryptedData = decryptUserPassword(encryptedData);
        if (decryptedData === null) {
            console.error("[AUTH_GATE] 无法解密用户凭证文件。文件可能已损坏或加密密钥已更改。");
            return {}; // 返回空对象，避免程序崩溃
        }
        return JSON.parse(decryptedData);
    } catch (error) {
        console.error("[AUTH_GATE] 读取或解析用户凭证失败:", error);
        if (error instanceof SyntaxError && fs.existsSync(USER_CREDENTIALS_STORAGE_FILE)) {
            console.warn("[AUTH_GATE] 用户凭证文件解析JSON失败，文件可能已损坏。将尝试重置为空。");
            try {
                saveUserCredentials({});
                return {};
            } catch (resetError) {
                console.error("[AUTH_GATE] 重置损坏的用户凭证文件失败:", resetError);
            }
        }
        return {};
    }
}

function saveUserCredentials(usersObject) {
    try {
        const dataToEncrypt = JSON.stringify(usersObject, null, 2);
        const encryptedData = encryptUserPassword(dataToEncrypt);
        fs.writeFileSync(USER_CREDENTIALS_STORAGE_FILE, encryptedData, 'utf8');
    } catch (error) {
        console.error("[AUTH_GATE] 保存用户凭证失败:", error);
        throw new Error("Failed to save user credentials.");
    }
}


// --- 3. Express 应用设置 ---
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const pageStyles = `
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background-color: #f8f9fa; /* 记事本页面背景色 */
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
        color: #212529; /* 记事本主要文字颜色 */
        padding: 20px 0;
        box-sizing: border-box;
    }
    .container {
        background-color: #fff; /* 卡片背景色 */
        padding: 30px 40px;
        border-radius: 0.25rem; /* 记事本卡片圆角 */
        box-shadow: 0 1px 3px rgba(0,0,0,0.05); /* 记事本卡片阴影 */
        border: 1px solid rgba(0,0,0,0.125); /* 记事本卡片边框 */
        text-align: center;
        width: 400px;
        max-width: 90%;
        margin-bottom: 20px;
    }
    .admin-container { /* 管理页面容器可以宽一些 */
        width: 800px;
        max-width: 95%;
        text-align: left;
    }
    h2 {
        margin-top: 0;
        margin-bottom: 25px;
        color: #212529;
        font-size: 1.75rem; /* 稍微调整标题大小 */
        font-weight: 500;
    }
    h3 {
        margin-top: 30px;
        margin-bottom: 15px;
        color: #212529;
        font-size: 1.25rem;
        border-bottom: 1px solid #dee2e6; /* 记事本风格的分割线 */
        padding-bottom: 8px;
        font-weight: 500;
    }
    input[type="password"], input[type="text"] {
        width: 100%;
        padding: 0.5rem 0.75rem; /* 记事本输入框内边距 */
        margin-bottom: 1rem; /* 记事本表单组间距 */
        border: 1px solid #ced4da; /* 记事本输入框边框颜色 */
        border-radius: 0.25rem; /* 记事本输入框圆角 */
        box-sizing: border-box;
        font-size: 1rem;
        line-height: 1.5;
        color: #495057;
        background-color: #fff;
        background-clip: padding-box;
        transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
    }
    input[type="password"]:focus, input[type="text"]:focus {
        border-color: #80bdff; /* 记事本输入框获取焦点颜色 */
        outline: 0;
        box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
    }
    button[type="submit"], .button-link { /* 统一按钮和链接按钮风格 */
        display: inline-block;
        font-weight: 400;
        color: #fff;
        text-align: center;
        vertical-align: middle;
        cursor: pointer;
        user-select: none;
        background-color: #007bff; /* 记事本主要按钮颜色 */
        border: 1px solid #007bff;
        padding: 0.5rem 1rem; /* 调整内边距以匹配标准按钮 */
        font-size: 1rem;
        line-height: 1.5;
        border-radius: 0.25rem; /* 记事本按钮圆角 */
        transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out, border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
        margin-top: 10px;
        text-decoration: none;
    }
    button[type="submit"].full-width {
        width: 100%;
    }
    button[type="submit"]:hover, .button-link:hover {
        background-color: #0056b3; /* 主要按钮悬停颜色 */
        border-color: #0056b3;
        color: #fff;
        text-decoration: none;
    }
    button[type="submit"].danger {
        background-color: #dc3545; /* 危险操作按钮颜色 */
        border-color: #dc3545;
    }
    button[type="submit"].danger:hover {
        background-color: #c82333;
        border-color: #bd2130;
    }
    .message { /* 消息提示框的基类 */
        margin-bottom: 1rem;
        font-weight: 500;
        font-size: 0.95em;
        padding: 0.75rem 1.25rem; /* 记事本风格的内边距 */
        border: 1px solid transparent;
        border-radius: 0.25rem; /* 记事本风格的圆角 */
    }
    .error-message {
        color: #721c24; /* 错误信息文字颜色 (Bootstrap danger text) */
        background-color: #f8d7da; /* 错误信息背景颜色 (Bootstrap danger background) */
        border-color: #f5c6cb; /* 错误信息边框颜色 (Bootstrap danger border) */
    }
    .success-message {
        color: #155724; /* 成功信息文字颜色 (Bootstrap success text) */
        background-color: #d4edda; /* 成功信息背景颜色 (Bootstrap success background) */
        border-color: #c3e6cb; /* 成功信息边框颜色 (Bootstrap success border) */
    }
    .info-message {
        color: #0c5460; /* Info 信息文字颜色 (Bootstrap info text) */
        background-color: #d1ecf1; /* Info 信息背景颜色 (Bootstrap info background) */
        border-color: #bee5eb; /* Info 信息边框颜色 (Bootstrap info border) */
        font-size: 0.85em;
        margin-top: 15px;
        line-height: 1.4;
    }
    label {
        display: block;
        text-align: left;
        margin-bottom: 0.5rem; /* 标签和输入框的间距 */
        font-weight: 500;
        font-size: 0.9em;
        color: #495057; /* 标签文字颜色 */
    }
    a { /* 普通链接颜色 */
        color: #007bff;
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
    table { /* 管理页面的表格 */
        width: 100%;
        border-collapse: collapse;
        margin-top: 1.5rem;
        background-color: #fff; /* 表格背景 */
    }
    th, td {
        text-align: left;
        padding: 0.75rem; /* 表格单元格内边距 */
        border-bottom: 1px solid #dee2e6; /* 表格分割线颜色 */
        vertical-align: middle;
    }
    th {
        background-color: #e9ecef; /* 表头背景色 */
        font-weight: 500;
        color: #495057;
    }
    .actions form {
        display: inline-block;
        margin-right: 5px;
    }
    .actions button { /* 表格中的操作按钮可以小一些 */
        padding: 0.25rem 0.5rem;
        font-size: 0.875rem;
        line-height: 1.5;
        margin-top: 0;
    }
    .form-row {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem; /* 元素间距 */
        align-items: flex-end;
        margin-bottom: 1rem;
    }
    .form-row .field {
        flex-grow: 1;
        min-width: 150px;
    }
    .form-row label, .form-row input {
        margin-bottom: 0; /* 在 form-row 中，标签和输入框底部无额外边距 */
    }
    .form-row button {
        align-self: flex-end;
    }
    .logout-link-container {
        width: 100%;
        text-align: right;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid #dee2e6;
    }
    .logout-link-container .button-link {
        background-color: #6c757d; /* 登出按钮使用次要颜色 */
        border-color: #6c757d;
    }
    .logout-link-container .button-link:hover {
        background-color: #5a6268;
        border-color: #545b62;
    }
    .nav-links {
        margin-top: 1.5rem;
        text-align: center;
    }
    .nav-links .button-link { margin: 0 0.5rem; }
`;


// --- 4. 启动模式判断和日志 ---
if (isMasterPasswordSetupNeeded) {
    console.log("[AUTH_GATE] 应用提示：未找到主密码配置文件。首次运行，请设置主密码。");
} else {
    console.log("[AUTH_GATE] 应用提示：主密码配置文件已存在。进入登录模式。");
}

// --- 5. 全局身份验证和设置重定向中间件 ---
app.use((req, res, next) => {
    const authRelatedPaths = ['/login', '/do_login', '/setup', '/do_setup'];
    const isAdminPath = req.path.startsWith('/admin');
    const isLogoutPath = req.path === '/logout';
    const staticAssetPath = req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/uploads/'); // 假设静态资源路径

    // 允许访问静态资源，不进行重定向
    if (staticAssetPath) {
        return next();
    }

    if (isMasterPasswordSetupNeeded) {
        if (req.path === '/setup' || req.path === '/do_setup') {
            return next();
        }
        return res.redirect('/setup');
    }

    // 如果已认证
    if (req.cookies.auth === '1') {
        if (isLogoutPath) return next();

        if (authRelatedPaths.includes(req.path)) {
             return res.redirect(req.cookies.is_master === 'true' ? '/admin' : '/');
        }
        if (isAdminPath && req.cookies.is_master !== 'true') {
            console.warn("[AUTH_GATE] 普通用户尝试访问管理页面:", req.path);
            return res.status(403).send(`
                <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>无权访问</title><style>${pageStyles}</style></head>
                <body><div class="container">
                    <h2 class="error-message">无权访问</h2>
                    <p>您没有权限访问此页面。仅主密码登录用户可访问管理面板。</p>
                    <a href="/" class="button-link">返回首页</a> <a href="/logout" class="button-link danger" style="margin-left:10px;">登出</a>
                </div></body></html>`);
        }
        // 如果已认证且不是访问管理或认证相关路径，则由代理处理或进入下一中间件
        return next();
    }

    // 如果未认证
    if (isLogoutPath) return res.redirect('/login');
    if (authRelatedPaths.includes(req.path)) {
        return next();
    }
    // 其他所有未认证的路径都重定向到登录
    return res.redirect('/login');
});

// --- 6. 路由定义 ---

// == SETUP MASTER PASSWORD ROUTES ==
app.get('/setup', (req, res) => {
    if (!isMasterPasswordSetupNeeded) {
         console.warn("[AUTH_GATE] 警告：主密码已设置，但仍到达 GET /setup 路由。重定向到登录页。");
         return res.redirect('/login');
    }
    const error = req.query.error;
    let errorMessageHtml = '';
    if (error === 'mismatch') errorMessageHtml = '<p class="message error-message">两次输入的密码不匹配！</p>';
    else if (error === 'short') errorMessageHtml = '<p class="message error-message">主密码长度至少需要8个字符！</p>';
    else if (error === 'write_failed') errorMessageHtml = '<p class="message error-message">保存主密码失败，请检查服务器权限或日志。</p>';
    else if (error === 'encrypt_failed') errorMessageHtml = '<p class="message error-message">主密码加密失败，请检查服务器日志。</p>';

    res.send(`
        <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>设置初始主密码</title><style>${pageStyles}</style></head>
        <body><div class="container">
            <form method="POST" action="/do_setup">
                <h2>首次运行：设置主密码</h2>
                ${errorMessageHtml}
                <label for="newPassword">新主密码 (至少8位):</label>
                <input type="password" id="newPassword" name="newPassword" required minlength="8" autofocus>
                <label for="confirmPassword">确认新主密码:</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required minlength="8">
                <button type="submit" class="full-width">设置主密码并保存</button>
                <p class="info-message">此主密码将用于首次登录及管理其他用户凭证。它将使用系统管理的主密钥进行加密后保存在服务器上。</p>
            </form>
        </div></body></html>
    `);
});

app.post('/do_setup', (req, res) => {
    if (!isMasterPasswordSetupNeeded) {
        return res.status(403).send("错误：主密码已设置。");
    }
    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
        return res.redirect('/setup?error=short');
    }
    if (newPassword !== confirmPassword) {
        return res.redirect('/setup?error=mismatch');
    }

    let encryptedPassword;
    try {
        encryptedPassword = encryptUserPassword(newPassword);
    } catch (error) {
        return res.redirect('/setup?error=encrypt_failed');
    }

    try {
        fs.writeFileSync(MASTER_PASSWORD_STORAGE_FILE, encryptedPassword, 'utf8');
        isMasterPasswordSetupNeeded = false;
        console.log("[AUTH_GATE] 主密码已成功设置并加密保存。应用现在进入登录模式。");
        // 确保用户凭证文件存在，如果不存在则创建一个空的
        if (!fs.existsSync(USER_CREDENTIALS_STORAGE_FILE)) {
            saveUserCredentials({});
            console.log("[AUTH_GATE] 空的用户凭证文件已创建。");
        }
        startMainApp(); // 主密码设置成功后启动主应用
        res.send(`
            <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>设置成功</title><style>${pageStyles}</style></head>
            <body><div class="container">
                <h2 class="success-message">主密码设置成功！</h2>
                <p>主应用服务已启动。您现在可以 <a href="/login">前往登录页面</a> 使用主密码登录。</p>
            </div></body></html>
        `);
    } catch (error) {
        console.error("[AUTH_GATE] 保存加密主密码文件失败:", error);
        res.redirect('/setup?error=write_failed');
    }
});

// == LOGIN ROUTES ==
app.get('/login', (req, res) => {
    // 如果已登录，则重定向
    if (req.cookies.auth === '1') {
        return res.redirect(req.cookies.is_master === 'true' ? '/admin' : '/');
    }

    const error = req.query.error;
    const info = req.query.info;
    let messageHtml = '';
    if (error === 'invalid') messageHtml = '<p class="message error-message">用户名或密码错误！</p>';
    else if (error === 'decrypt_failed') messageHtml = '<p class="message error-message">无法验证密码。可能是密钥问题或文件损坏。</p>';
    else if (error === 'read_failed') messageHtml = '<p class="message error-message">无法读取密码配置。请联系管理员。</p>';
    else if (error === 'no_user_file') messageHtml = '<p class="message error-message">用户凭证文件不存在或无法读取，请先使用主密码登录并检查。</p>';
    else if (error === 'master_not_set') messageHtml = `<p class="message error-message">主密码尚未设置，请先 <a href="/setup">设置主密码</a>。</p>`;
    else if (error === 'internal_state') messageHtml = `<p class="message error-message">内部状态错误，请尝试 <a href="/setup">重新设置主密码</a> (如果适用) 或联系管理员。</p>`;
    else if (info === 'logged_out') messageHtml = '<p class="message success-message">您已成功登出。</p>';

    res.send(`
        <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>登录</title><style>${pageStyles}</style></head>
        <body><div class="container">
            <form method="POST" action="/do_login" id="loginForm">
                <h2>请输入访问密码</h2>
                ${messageHtml}
                <label for="username">用户名:</label>
                <input type="text" id="username" name="username" autofocus>
                <label for="password">密码:</label>
                <input type="password" id="password" name="password" required>
                <button type="submit" class="full-width">登录</button>
            </form>
        </div>
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                const usernameInput = document.getElementById('username');
                const passwordInput = document.getElementById('password');
                const loginForm = document.getElementById('loginForm');
                // const submitButton = loginForm.querySelector('button[type="submit"]'); // Not strictly needed if form auto-submits

                function handleEnterKey(event) {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        // 简单地触发submit事件，让浏览器处理
                        // 如果需要更复杂的逻辑，可以手动调用 loginForm.requestSubmit(submitButton);
                        loginForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    }
                }

                if (usernameInput) {
                    usernameInput.addEventListener('keydown', handleEnterKey);
                }
                if (passwordInput) {
                    passwordInput.addEventListener('keydown', handleEnterKey);
                }
            });
        </script>
        </body></html>
    `);
});

app.post('/do_login', (req, res) => {
    if (isMasterPasswordSetupNeeded) {
        return res.redirect('/login?error=master_not_set');
    }
    const { username, password: submittedPassword } = req.body;

    if (!submittedPassword) {
        return res.redirect('/login?error=invalid');
    }

    try {
        // 主密码登录 (用户名为空)
        if (!username || username.trim() === "") {
            if (!fs.existsSync(MASTER_PASSWORD_STORAGE_FILE)) {
                 console.error("[AUTH_GATE] 登录失败：主密码文件未找到，但应用未处于设置模式。");
                 isMasterPasswordSetupNeeded = true;
                 return res.redirect('/setup?error=internal_state'); // 引导用户重新设置
            }
            const encryptedMasterPasswordFromFile = fs.readFileSync(MASTER_PASSWORD_STORAGE_FILE, 'utf8');
            if (!encryptedMasterPasswordFromFile.trim()) {
                console.error("[AUTH_GATE] 登录失败：主密码文件为空。");
                isMasterPasswordSetupNeeded = true;
                return res.redirect('/setup?error=internal_state');
            }
            const storedDecryptedMasterPassword = decryptUserPassword(encryptedMasterPasswordFromFile);

            if (storedDecryptedMasterPassword === null) {
                return res.redirect('/login?error=decrypt_failed');
            }
            if (submittedPassword === storedDecryptedMasterPassword) {
                res.cookie('auth', '1', { maxAge: 3600 * 1000, httpOnly: true, path: '/', sameSite: 'Lax' }); // 1 hour
                res.cookie('is_master', 'true', { maxAge: 3600 * 1000, httpOnly: true, path: '/', sameSite: 'Lax' });
                console.log("[AUTH_GATE] 主密码登录成功。");
                return res.redirect('/admin');
            } else {
                return res.redirect('/login?error=invalid');
            }
        } else { // 普通用户登录
            if (!fs.existsSync(USER_CREDENTIALS_STORAGE_FILE)) {
                 console.warn("[AUTH_GATE] 用户尝试登录，但用户凭证文件不存在。");
                 return res.redirect('/login?error=no_user_file');
            }
            const users = readUserCredentials();
            // 检查用户凭证文件在解密后是否为空对象，但文件本身有内容（可能解密失败）
            if (Object.keys(users).length === 0 && fs.existsSync(USER_CREDENTIALS_STORAGE_FILE) && fs.readFileSync(USER_CREDENTIALS_STORAGE_FILE, 'utf8').trim().length > 0) {
                console.warn("[AUTH_GATE] 用户凭证文件可能已损坏或无法解密（密钥不匹配？）。");
                return res.redirect('/login?error=decrypt_failed'); // 提示解密失败
            }

            const userData = users[username];

            if (!userData || !userData.passwordHash) {
                return res.redirect('/login?error=invalid');
            }

            const storedDecryptedPassword = decryptUserPassword(userData.passwordHash);
            if (storedDecryptedPassword === null) {
                console.error(`[AUTH_GATE] 解密用户 '${username}' 的密码失败。`);
                return res.redirect('/login?error=decrypt_failed');
            }

            if (submittedPassword === storedDecryptedPassword) {
                res.cookie('auth', '1', { maxAge: 3600 * 1000, httpOnly: true, path: '/', sameSite: 'Lax' });
                res.cookie('is_master', 'false', { maxAge: 3600 * 1000, httpOnly: true, path: '/', sameSite: 'Lax' });
                console.log(`[AUTH_GATE] 用户 '${username}' 登录成功。重定向到主应用 /`);
                return res.redirect('/');
            } else {
                return res.redirect('/login?error=invalid');
            }
        }
    } catch (error) {
        if (error.code === 'ENOENT' && error.path === MASTER_PASSWORD_STORAGE_FILE) {
            console.error("[AUTH_GATE] 登录失败：主密码文件未找到（意外）。", error);
            isMasterPasswordSetupNeeded = true;
            return res.redirect('/setup?error=internal_state');
        }
        console.error("[AUTH_GATE] 读取密码文件或登录处理时发生未知错误:", error);
        res.status(500).send("服务器内部错误，无法处理登录请求。");
    }
});

// == LOGOUT ROUTE ==
app.get('/logout', (req, res) => {
    res.clearCookie('auth', { path: '/', httpOnly: true, sameSite: 'Lax' });
    res.clearCookie('is_master', { path: '/', httpOnly: true, sameSite: 'Lax' });
    console.log("[AUTH_GATE] 用户已登出。");
    res.redirect('/login?info=logged_out');
});


// == ADMIN ROUTES (User Management) ==
function ensureMasterAdmin(req, res, next) {
    if (req.cookies.auth === '1' && req.cookies.is_master === 'true') {
        return next();
    }
    console.warn("[AUTH_GATE] 未授权访问管理区域，Cookie: ", req.cookies);
    res.status(403).send(`
        <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>访问被拒绝</title><style>${pageStyles}</style></head>
        <body><div class="container">
            <h2 class="error-message">访问被拒绝</h2>
            <p>您必须以主密码用户身份登录才能访问此页面。</p>
            <a href="/login" class="button-link">去登录</a>
            <a href="/" class="button-link" style="margin-left:10px; background-color:#6c757d; border-color:#6c757d;">返回首页</a>
        </div></body></html>`);
}

app.get('/admin', ensureMasterAdmin, (req, res) => {
    const users = readUserCredentials();
    const error = req.query.error;
    const success = req.query.success;
    let messageHtml = '';
    if (error === 'user_exists') messageHtml = '<p class="message error-message">错误：用户名已存在。</p>';
    else if (error === 'password_mismatch') messageHtml = '<p class="message error-message">错误：两次输入的密码不匹配。</p>';
    else if (error === 'missing_fields') messageHtml = '<p class="message error-message">错误：所有必填字段不能为空。</p>';
    else if (error === 'unknown') messageHtml = '<p class="message error-message">发生未知错误。</p>';
    else if (error === 'user_not_found') messageHtml = '<p class="message error-message">错误: 未找到指定用户。</p>';
    else if (error === 'invalid_username') messageHtml = '<p class="message error-message">错误: 用户名不能是 "master" 或包含特殊字符。</p>';


    if (success === 'user_added') messageHtml = '<p class="message success-message">用户添加成功。</p>';
    else if (success === 'user_deleted') messageHtml = '<p class="message success-message">用户删除成功。</p>';
    else if (success === 'password_changed') messageHtml = '<p class="message success-message">用户密码修改成功。</p>';


    let usersTableHtml = '<table><thead><tr><th>用户名</th><th>操作</th></tr></thead><tbody>';
    if (Object.keys(users).length === 0) {
        usersTableHtml += '<tr><td colspan="2" style="text-align:center;">当前没有普通用户。</td></tr>';
    } else {
        for (const username in users) {
            usersTableHtml += `
                <tr>
                    <td>${username}</td>
                    <td class="actions">
                        <form method="POST" action="/admin/delete_user" style="display:inline;">
                            <input type="hidden" name="usernameToDelete" value="${username}">
                            <button type="submit" class="danger" onclick="return confirm('确定要删除用户 ${username} 吗？');">删除</button>
                        </form>
                        <form method="POST" action="/admin/change_password_page" style="display:inline;">
                             <input type="hidden" name="usernameToChange" value="${username}">
                             <button type="submit">修改密码</button>
                        </form>
                    </td>
                </tr>`;
        }
    }
    usersTableHtml += '</tbody></table>';

    res.send(`
        <!DOCTYPE html><html lang="zh-CN">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>用户管理</title><style>${pageStyles}</style></head>
        <body>
            <div class="container admin-container">
                <div class="logout-link-container"><a href="/logout" class="button-link">登出主账户</a></div>
                <h2>用户管理面板 (主账户)</h2>
                ${messageHtml}

                <h3>现有用户</h3>
                ${usersTableHtml}

                <h3>添加新用户</h3>
                <form method="POST" action="/admin/add_user">
                    <div class="form-row">
                        <div class="field">
                            <label for="newUsername">新用户名:</label>
                            <input type="text" id="newUsername" name="newUsername" required>
                        </div>
                        <div class="field">
                            <label for="newUserPassword">新用户密码:</label>
                            <input type="password" id="newUserPassword" name="newUserPassword" required>
                        </div>
                         <div class="field">
                            <label for="confirmNewUserPassword">确认密码:</label>
                            <input type="password" id="confirmNewUserPassword" name="confirmNewUserPassword" required>
                        </div>
                        <button type="submit">添加用户</button>
                    </div>
                </form>
                <div class="nav-links">
                    <a href="/" class="button-link" style="background-color:#28a745; border-color:#28a745;">访问主应用 (记事本)</a>
                </div>
            </div>
        </body></html>
    `);
});

app.post('/admin/add_user', ensureMasterAdmin, (req, res) => {
    const { newUsername, newUserPassword, confirmNewUserPassword } = req.body;
    if (!newUsername || !newUserPassword || !confirmNewUserPassword ) {
        return res.redirect('/admin?error=missing_fields');
    }
    if (newUserPassword !== confirmNewUserPassword) {
        return res.redirect('/admin?error=password_mismatch');
    }
     // 简单用户名验证：不允许 "master" 且只允许字母数字下划线
    if (newUsername.toLowerCase() === "master" || !/^[a-zA-Z0-9_]+$/.test(newUsername)) {
        return res.redirect('/admin?error=invalid_username');
    }


    const users = readUserCredentials();
    if (users[newUsername]) {
        return res.redirect('/admin?error=user_exists');
    }


    try {
        users[newUsername] = { passwordHash: encryptUserPassword(newUserPassword) };
        saveUserCredentials(users);
        console.log(`[AUTH_GATE_ADMIN] 用户 '${newUsername}' 已添加。`);
        res.redirect('/admin?success=user_added');
    } catch (error) {
        console.error("[AUTH_GATE_ADMIN] 添加用户失败:", error);
        res.redirect('/admin?error=unknown');
    }
});

app.post('/admin/delete_user', ensureMasterAdmin, (req, res) => {
    const { usernameToDelete } = req.body;
    if (!usernameToDelete) {
        return res.redirect('/admin?error=unknown');
    }
    const users = readUserCredentials();
    if (!users[usernameToDelete]) {
        return res.redirect('/admin?error=user_not_found');
    }
    delete users[usernameToDelete];
    try {
        saveUserCredentials(users);
        console.log(`[AUTH_GATE_ADMIN] 用户 '${usernameToDelete}' 已删除。`);
        res.redirect('/admin?success=user_deleted');
    } catch (error) {
        console.error(`[AUTH_GATE_ADMIN] 删除用户 '${usernameToDelete}' 失败:`, error);
        res.redirect('/admin?error=unknown');
    }
});

app.post('/admin/change_password_page', ensureMasterAdmin, (req, res) => {
    const { usernameToChange } = req.body;
    const error = req.query.error; // 获取错误信息
    let errorMessageHtml = '';
    if (error === 'mismatch') errorMessageHtml = '<p class="message error-message">两次输入的密码不匹配！</p>';
    else if (error === 'missing_fields') errorMessageHtml = '<p class="message error-message">错误：所有密码字段均为必填项。</p>';
    else if (error === 'unknown') errorMessageHtml = '<p class="message error-message">发生未知错误。</p>';


    if (!usernameToChange) return res.redirect('/admin?error=unknown');

    const users = readUserCredentials();
    if (!users[usernameToChange]) {
        return res.redirect('/admin?error=user_not_found');
    }

    res.send(`
        <!DOCTYPE html><html lang="zh-CN">
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>修改用户密码</title><style>${pageStyles}</style></head>
        <body>
            <div class="container">
                <h2>修改用户 '${usernameToChange}' 的密码</h2>
                ${errorMessageHtml}
                <form method="POST" action="/admin/perform_change_password">
                    <input type="hidden" name="username" value="${usernameToChange}">
                    <label for="newPassword">新密码:</label>
                    <input type="password" id="newPassword" name="newPassword" required autofocus>
                    <label for="confirmPassword">确认新密码:</label>
                    <input type="password" id="confirmPassword" name="confirmPassword" required>
                    <button type="submit" class="full-width">确认修改密码</button>
                    <div class="nav-links">
                        <a href="/admin" class="button-link" style="background-color:#6c757d; border-color:#6c757d;">返回用户管理</a>
                    </div>
                </form>
            </div>
        </body></html>
    `);
});

app.post('/admin/perform_change_password', ensureMasterAdmin, (req, res) => {
    const { username, newPassword, confirmPassword } = req.body;
    if (!username || !newPassword || !confirmPassword) {
         // 当字段缺失时，重定向回修改页面并带上错误提示
         return res.redirect(`/admin/change_password_page?usernameToChange=${encodeURIComponent(username)}&error=missing_fields`);
    }
    if (newPassword !== confirmPassword) {
        return res.redirect(`/admin/change_password_page?usernameToChange=${encodeURIComponent(username)}&error=mismatch`);
    }

    const users = readUserCredentials();
    if (!users[username]) {
        return res.redirect('/admin?error=user_not_found'); // 如果用户在此期间被删除
    }

    try {
        users[username].passwordHash = encryptUserPassword(newPassword);
        saveUserCredentials(users);
        console.log(`[AUTH_GATE_ADMIN] 用户 '${username}' 的密码已修改。`);
        res.redirect('/admin?success=password_changed');
    } catch (error) {
        console.error(`[AUTH_GATE_ADMIN] 修改用户 '${username}' 密码失败:`, error);
        res.redirect(`/admin/change_password_page?usernameToChange=${encodeURIComponent(username)}&error=unknown`);
    }
});


// --- 7. 反向代理中间件 ---
const proxyToMainApp = createProxyMiddleware({
    target: `http://localhost:${APP_INTERNAL_PORT}`,
    changeOrigin: true,
    ws: true, // 支持 WebSocket (如果主应用使用)
    logLevel: 'info', // 'debug', 'info', 'warn', 'error', 'silent'
    onError: (err, req, res, target) => { // 确保 res 和 target 参数可用
        console.error('[AUTH_GATE_PROXY] 代理发生错误:', err.message, '请求:', req.method, req.url, '目标:', target);
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
             try {
                res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
            } catch (e) { console.error("Error writing head for proxy error:", e); }
        }
        // 确保 res 对象存在并且可写
        if (res && typeof res.end === 'function' && res.writable && !res.writableEnded) {
            try {
                res.end(`
                    <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>代理错误</title><style>${pageStyles}</style></head>
                    <body><div class="container">
                        <h2 class="error-message">代理错误 (502 Bad Gateway)</h2>
                        <p>抱歉，无法连接到后端应用程序 (记事本服务)。</p>
                        <p>可能的原因：</p>
                        <ul>
                            <li>主应用 (server.js) 未能启动或已崩溃。</li>
                            <li>主应用未在预期的内部端口 ${APP_INTERNAL_PORT} 上监听。</li>
                            <li>网络配置问题阻止了连接。</li>
                        </ul>
                        <p>请检查服务器日志以获取更多信息。</p>
                        <p>错误详情: ${err.message}</p>
                        <div class="nav-links">
                            <a href="/" class="button-link" onclick="location.reload(); return false;">重试</a>
                            <a href="/logout" class="button-link danger" style="margin-left:10px;">登出</a>
                        </div>
                    </div></body></html>
                `);
            } catch (e) { console.error("Error ending response for proxy error:", e); }
        } else if (res && typeof res.end === 'function' && !res.writableEnded) {
             // 如果流不可写但尚未结束，尝试结束它
            try { res.end(); } catch (e) { /* ignore */ }
        }
    }
});

// 应用代理中间件，但仅对已认证且非管理路径的请求生效
app.use((req, res, next) => {
    // 代理所有非 /admin, /setup, /login, /do_login, /do_setup, /logout 的已认证请求
    if (req.cookies.auth === '1' &&
        !req.path.startsWith('/admin') &&
        req.path !== '/setup' && req.path !== '/do_setup' &&
        req.path !== '/login' && req.path !== '/do_login' &&
        req.path !== '/logout') {
        return proxyToMainApp(req, res, next);
    }
    // 对于其他情况（例如未被特定路由处理的未认证请求，或已认证但访问管理路径且未被 ensureMasterAdmin 拦截的），
    // 此处不应有太多请求到达，因为它们应该已被前面的中间件处理。
    // 如果有请求到达这里，可能是逻辑错误或未覆盖的边缘情况。
    console.warn(`[AUTH_GATE] 请求 ${req.method} ${req.path} 未被特定路由或代理处理（意外情况）。Auth: ${req.cookies.auth}, Master: ${req.cookies.is_master}`);
    // 可以选择发送 404 或调用 next() 让 Express 的默认 404 处理
    // 为了安全，如果到这里仍未处理，可以返回一个通用错误或404
     if (!res.headersSent) {
        res.status(404).send(`
             <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>未找到</title><style>${pageStyles}</style></head>
             <body><div class="container">
                 <h2 class="error-message">404 - 页面未找到</h2>
                 <p>您请求的资源不存在。</p>
                 <a href="/" class="button-link">返回首页</a>
             </div></body></html>`);
    }
    // next(); // 如果希望 Express 的默认404处理
});


// --- 8. 服务器启动 ---
const server = app.listen(PUBLIC_PORT, () => {
    console.log(`[AUTH_GATE] 认证网关与反向代理服务已在端口 ${PUBLIC_PORT} 上启动。`);
    if (isMasterPasswordSetupNeeded) {
        console.log(`[AUTH_GATE] 请访问 http://localhost:${PUBLIC_PORT}/setup 完成初始主密码设置。`);
    } else {
        console.log(`[AUTH_GATE] 主应用将由本服务管理。请访问 http://localhost:${PUBLIC_PORT}/login 进行登录。`);
        if (!serverJsProcess || serverJsProcess.killed) {
            startMainApp();
        }
    }
    console.warn(
        `[AUTH_GATE] 安全提示：用户密码使用 AES-256-CBC 加密。` +
        `请确保 ${MASTER_SECRET_KEY_FILE} 文件的安全和备份。此文件是解密所有密码的关键！`
    );
});

server.on('error', (error) => {
    if (error.syscall !== 'listen') {
        console.error('[AUTH_GATE] 发生了一个非监听相关的服务器错误:', error);
        return;
    }
    switch (error.code) {
        case 'EACCES':
            console.error(`[AUTH_GATE] 错误：端口 ${PUBLIC_PORT} 需要提升的权限。请尝试使用 sudo 或以管理员身份运行，或使用大于1024的端口。`);
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.error(`[AUTH_GATE] 错误：端口 ${PUBLIC_PORT} 已被其他应用程序占用。请关闭占用该端口的程序或更改 PUBLIC_PORT 配置。`);
            process.exit(1);
            break;
        default:
            console.error('[AUTH_GATE] 服务器启动时发生未知监听错误:', error);
            process.exit(1);
    }
});

// --- 9. 优雅关闭处理 ---
function shutdownGracefully(signal) {
    if (isShuttingDown) return; // 防止重复执行
    isShuttingDown = true;
    console.log(`[AUTH_GATE] 收到 ${signal}。正在关闭服务...`);

    const serverClosePromise = new Promise((resolve, reject) => {
        server.close((err) => {
            if (err) {
                console.error('[AUTH_GATE] 关闭 HTTP 服务时发生错误:', err);
                return reject(err);
            }
            console.log('[AUTH_GATE] HTTP 服务已关闭。');
            resolve();
        });
    });

    const childProcessPromise = new Promise((resolve) => {
        if (serverJsProcess && !serverJsProcess.killed) {
            console.log('[AUTH_GATE] 正在尝试终止主应用 (server.js)...');

            const killTimeout = setTimeout(() => {
                if (serverJsProcess && !serverJsProcess.killed) {
                    console.warn('[AUTH_GATE] 主应用未在 SIGTERM 后3秒内退出，强制发送 SIGKILL...');
                    serverJsProcess.kill('SIGKILL'); // 强制终止
                }
                resolve(); // 无论如何都要 resolve
            }, 3000);

            serverJsProcess.on('exit', (code, exitSignal) => {
                clearTimeout(killTimeout);
                console.log(`[AUTH_GATE] 主应用已成功退出 (Code: ${code}, Signal: ${exitSignal})。`);
                resolve();
            });

            const killed = serverJsProcess.kill('SIGTERM'); // 尝试优雅终止
            if (!killed && serverJsProcess && !serverJsProcess.killed) {
                 console.warn('[AUTH_GATE] 向主应用发送 SIGTERM 信号失败 (可能已退出或无权限)。');
                 clearTimeout(killTimeout); // 如果发送失败，也清除超时
                 resolve();
            } else if (!serverJsProcess || serverJsProcess.killed) { // 如果已经死了或不存在
                clearTimeout(killTimeout);
                resolve();
            }
        } else {
            console.log('[AUTH_GATE] 主应用未运行或已被终止。');
            resolve();
        }
    });

    Promise.all([serverClosePromise, childProcessPromise]).then(() => {
        console.log('[AUTH_GATE] 所有服务已关闭。优雅退出。');
        process.exit(0);
    }).catch(err => {
        console.error('[AUTH_GATE] 优雅关闭期间发生错误:', err);
        process.exit(1); // 即使有错误也退出
    });

    // 设置一个总的关闭超时，以防万一
    setTimeout(() => {
        console.error('[AUTH_GATE] 优雅关闭超时 (10秒)，强制退出。');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => shutdownGracefully('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => shutdownGracefully('SIGTERM')); // kill 命令
