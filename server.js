// server.js - 主服务器逻辑
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleRequest } = require('./router');
const storage = require('./storage'); // 引入 storage 模块

const PORT = process.env.PORT || 8100;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

function initializeDirectories() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`目录 ${DATA_DIR} 已创建。`);
    }
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        console.log(`目录 ${UPLOADS_DIR} 已创建。`);
    }
    if (!fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
        fs.writeFileSync(path.join(DATA_DIR, 'users.json'), '[]', 'utf8');
        console.log(`文件 ${path.join(DATA_DIR, 'users.json')} 已创建。`);
    }
    if (!fs.existsSync(path.join(DATA_DIR, 'notes.json'))) {
        fs.writeFileSync(path.join(DATA_DIR, 'notes.json'), '[]', 'utf8');
        console.log(`文件 ${path.join(DATA_DIR, 'notes.json')} 已创建。`);
    }
}

function initializeAdminUser() {
    const adminUsername = 'admin';
    if (!storage.findUserByUsername(adminUsername)) {
        storage.saveUser({
            username: adminUsername,
            password: 'admin', // 初始明文密码，storage.saveUser 会哈希
            role: 'admin'
        });
        console.log(`默认管理员账户 '${adminUsername}' (密码: 'admin') 已创建。`);
    }
}

const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        handleRequest(req, res, rawBuffer);
    });
    req.on('error', (err) => {
        console.error('请求错误:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('服务器内部错误');
    });
});

server.listen(PORT, () => {
    initializeDirectories();
    // 移除了 storage.initializeAnonymousUser(); 
    // "anyone" 用户现在由管理员通过用户管理界面手动创建/删除。
    initializeAdminUser(); 
    console.log(`服务器正在监听 http://localhost:${PORT}/`);
    console.log("提示：密码已加密存储。");
});

process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的 Promise Rejection:', promise, '原因:', reason);
});
