// auth.js - 用户认证与会话管理 (使用哈希密码)
const crypto = require('crypto');
const storage = require('./storage');

const sessions = {};
const SESSION_DURATION = 24 * 60 * 60 * 1000;

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader = '') {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        try { list[name] = decodeURIComponent(value); }
        catch (e) { list[name] = value; }
    });
    return list;
}

module.exports = {
    verifyPassword: (providedPassword, salt, hashedPassword) => {
        if (hashedPassword === '') {
            return (providedPassword === '' || providedPassword === null || providedPassword === undefined);
        }
        if (providedPassword === '' || providedPassword === null || providedPassword === undefined) {
            return false;
        }
        return storage.hashPassword(providedPassword, salt) === hashedPassword;
    },
    login: (res, userSessionData) => {
        const sessionId = generateSessionId();
        const expiresAt = Date.now() + SESSION_DURATION;
        sessions[sessionId] = {
            userId: userSessionData.id,
            username: userSessionData.username,
            role: userSessionData.role,
            expiresAt
        };
        res.setHeader('Set-Cookie', `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION / 1000}; SameSite=Lax`);
    },
    logout: (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;
        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId];
        }
        res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    },
    authenticate: (req) => {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies.sessionId;

        if (sessionId && sessions[sessionId]) {
            const sessionData = sessions[sessionId];
            if (sessionData.expiresAt > Date.now()) {
                return sessionData;
            } else {
                delete sessions[sessionId];
            }
        }

        // 如果没有有效会话，检查 "anyone" 用户是否存在以提供匿名访问
        const anyoneUser = storage.findUserByUsername('anyone');
        if (anyoneUser && anyoneUser.role === 'anonymous') {
            console.log('提供匿名用户访问权限。');
            return {
                userId: anyoneUser.id, // 或者一个特殊的匿名ID
                username: 'anyone',
                role: 'anonymous',
                isAnonymous: true // 添加一个标记
            };
        }
        return null; // 没有有效会话，且 "anyone" 用户不存在或配置不正确
    },
    cleanupExpiredSessions: () => {
        const now = Date.now();
        let cleanedCount = 0;
        for (const sessionId in sessions) {
            if (sessions[sessionId].expiresAt <= now) {
                delete sessions[sessionId];
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) console.log(`已清理 ${cleanedCount} 个过期会话。`);
    }
};
setInterval(module.exports.cleanupExpiredSessions, 60 * 60 * 1000);
