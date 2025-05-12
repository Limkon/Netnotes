// userController.js - 用户相关操作的控制器
const storage = require('./storage');
const auth = require('./auth');
const {
    serveHtmlWithPlaceholders,
    serveJson,
    redirect,
    sendError,
    sendUnauthorized,
    sendForbidden,
    sendBadRequest,
    sendNotFound 
} = require('./responseUtils');
const path =require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

function getGeneralNavData(session) {
    return {
        username: session ? session.username : '访客',
        userRole: session ? session.role : 'anonymous',
        userId: session ? session.userId : ''
    };
}

module.exports = {
    getLoginPage: (context) => {
        if (context.session && context.session.role !== 'anonymous') {
            return redirect(context.res, '/');
        }
        serveHtmlWithPlaceholders(context.res, path.join(PUBLIC_DIR, 'login.html'), {
            error_message: context.query.error || '',
            username_value: context.query.username_value || '',
            ...getGeneralNavData(context.session) 
        });
    },

    loginUser: (context) => {
        const { username, password } = context.body;
        if (!username) {
            return serveHtmlWithPlaceholders(context.res, path.join(PUBLIC_DIR, 'login.html'), {
                error_message: '用户名不能为空。', username_value: username || '',
                ...getGeneralNavData(context.session)
            }, 400);
        }
        const user = storage.findUserByUsername(username); 

        if (user && user.salt && auth.verifyPassword(password, user.salt, user.hashedPassword)) {
            auth.login(context.res, { id: user.id, username: user.username, role: user.role });
            redirect(context.res, '/');
        } else {
            serveHtmlWithPlaceholders(context.res, path.join(PUBLIC_DIR, 'login.html'), {
                error_message: '用户名或密码错误。', username_value: username || '',
                ...getGeneralNavData(context.session)
            }, 401);
        }
    },

    logoutUser: (context) => {
        auth.logout(context.req, context.res);
        redirect(context.res, '/login');
    },

    getRegisterPage: (context) => {
        if (context.session && context.session.role !== 'anonymous') { 
            return redirect(context.res, '/');
        }
        serveHtmlWithPlaceholders(context.res, path.join(PUBLIC_DIR, 'register.html'), {
            ...getGeneralNavData(context.session)
        });
    },

    registerUser: (context) => {
        const { username, password } = context.body; 
        if (!username || username.trim() === '') {
            context.res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "用户名不能为空。" }));
        }
        if (storage.findUserByUsername(username.trim())) {
            context.res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "此用户名已被注册。" }));
        }
        const newUser = storage.saveUser({
            username: username.trim(),
            password: password, 
            role: 'user' 
        });
        if (newUser && newUser.id) {
            serveJson(context.res, { id: newUser.id, username: newUser.username, role: newUser.role }, 201);
        } else {
            context.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            context.res.end(JSON.stringify({ message: "注册过程中发生错误，请稍后再试。" }));
        }
    },
    
    getAdminUsersPage: (context) => {
        if (!context.session || context.session.role !== 'admin') {
            return sendForbidden(context.res, "您没有权限访问此页面。");
        }
        serveHtmlWithPlaceholders(context.res, path.join(PUBLIC_DIR, 'admin.html'), {
            adminUsername: context.session.username, 
            adminUserId: context.session.userId,   
            username: context.session.username,    
            userRole: context.session.role,
            userId: context.session.userId         
        });
    },

    listAllUsers: (context) => {
        const users = storage.getUsers().map(u => ({
            id: u.id,
            username: u.username,
            role: u.role
        }));
        serveJson(context.res, users);
    },

    createUserByAdmin: (context) => {
        const { username, password, role = 'user' } = context.body;
        if (!username || username.trim() === '') {
             context.res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
             return context.res.end(JSON.stringify({ message: "用户名不能为空。" }));
        }
        if (role === 'admin' && (!password || password.trim() === '')) {
            context.res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "管理员的密码不能为空。" }));
        }
        
        if (storage.findUserByUsername(username.trim())) {
            context.res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "用户名已存在。" }));
        }
        
        const newUser = storage.saveUser({ username: username.trim(), password: password, role });
        if (newUser && newUser.id) { 
            serveJson(context.res, { id: newUser.id, username: newUser.username, role: newUser.role }, 201);
        } else {
            context.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            context.res.end(JSON.stringify({ message: "创建用户失败。可能是用户名已存在或发生内部错误。" }));
        }
    },

    deleteUserByAdmin: (context) => {
        const pathParts = context.pathname.split('/'); 
        const userIdToDelete = pathParts[4]; 
        
        if (!userIdToDelete) {
             context.res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
             return context.res.end(JSON.stringify({ message: "缺少用户 ID。" }));
        }
        const userToDelete = storage.findUserById(userIdToDelete);
        if (!userToDelete) {
            context.res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "找不到要删除的用户。" }));
        }
        if (userIdToDelete === context.session.userId) {
            context.res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "管理员不能删除自己的帐号。" }));
        }
        if (userToDelete.role === 'admin') {
            const allUsers = storage.getUsers();
            const adminUsers = allUsers.filter(u => u.role === 'admin');
            if (adminUsers.length <= 1) {
                context.res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                return context.res.end(JSON.stringify({ message: "不能删除最后一位管理员。系统至少需要一位管理员。" }));
            }
        }
        if (storage.deleteUser(userIdToDelete)) {
            serveJson(context.res, { message: `用户 ${userToDelete.username} (ID: ${userIdToDelete}) 已成功删除。` });
        } else {
            context.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            context.res.end(JSON.stringify({ message: "删除用户失败。" }));
        }
    },

    updateUserPasswordByAdmin: (context) => {
        const pathParts = context.pathname.split('/'); 
        const userIdToUpdate = pathParts[4]; 
        const { newPassword } = context.body;
        
        // console.log(`[Admin Reset Password] Attempting to reset password for user ID: ${userIdToUpdate}`);
        // console.log(`[Admin Reset Password] Received new password (length): ${newPassword ? newPassword.length : 'undefined/null'}`);

        if (!userIdToUpdate) {
            // console.error("[Admin Reset Password] Error: Missing user ID from path.");
            return sendBadRequest(context.res, JSON.stringify({ message: "路径中缺少用户 ID。" }));
        }
        const userToUpdate = storage.findUserById(userIdToUpdate);
        if (!userToUpdate) {
            // console.error(`[Admin Reset Password] Error: User not found for ID: ${userIdToUpdate}`);
            context.res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "找不到要更新密码的用户。" }));
        }

        // console.log(`[Admin Reset Password] User found: ${userToUpdate.username}, Role: ${userToUpdate.role}`);

        if (userToUpdate.role === 'admin' && (newPassword === undefined || newPassword === null || newPassword.trim() === '')) {
            // console.warn(`[Admin Reset Password] Error: Admin user (${userToUpdate.username}) cannot have an empty password.`);
            return sendBadRequest(context.res, JSON.stringify({ message: "管理员的新密码不能为空。" }));
        }
        
        const userDataForUpdate = { 
            id: userToUpdate.id, 
            username: userToUpdate.username, 
            role: userToUpdate.role, 
            salt: userToUpdate.salt, 
            password: newPassword 
        };

        // console.log(`[Admin Reset Password] Calling storage.saveUser for user: ${userToUpdate.username}`);
        const updatedUser = storage.saveUser(userDataForUpdate);
        
        if (updatedUser && updatedUser.id) { 
            // console.log(`[Admin Reset Password] Successfully updated password for user: ${userToUpdate.username}`);
            serveJson(context.res, { message: `用户 ${userToUpdate.username} 的密码已成功更新。` });
        } else {
            // console.error(`[Admin Reset Password] Failed to update password for user: ${userToUpdate.username}. storage.saveUser returned:`, updatedUser);
            context.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            context.res.end(JSON.stringify({ message: "更新密码失败。请查看服务器日志。" }));
        }
    },

    getChangePasswordPage: (context) => {
        if (!context.session || context.session.role === 'anonymous') { 
             return redirect(context.res, '/login');
        }
        serveHtmlWithPlaceholders(context.res, path.join(PUBLIC_DIR, 'change-password.html'), {
            ...getGeneralNavData(context.session) 
        });
    },

    changeOwnPassword: (context) => {
        const { currentPassword, newPassword, confirmNewPassword } = context.body;
        const userId = context.session.userId;

        if (newPassword !== confirmNewPassword) {
            return sendBadRequest(context.res, JSON.stringify({ message: "新密码和确认密码不匹配。" }));
        }
        
        const user = storage.findUserById(userId);
        if (!user || !user.salt) { 
            context.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "无法验证当前用户。" }));
        }

        if (!auth.verifyPassword(currentPassword, user.salt, user.hashedPassword)) {
            context.res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return context.res.end(JSON.stringify({ message: "当前密码不正确。" }));
        }
        
        if (user.role === 'admin' && newPassword.trim() === '') {
             return sendBadRequest(context.res, JSON.stringify({ message: "管理员的新密码不能为空。" }));
        }

        const updatedUser = storage.saveUser({ ...user, password: newPassword });
        if (updatedUser) {
            serveJson(context.res, { message: "密码已成功修改。" });
        } else {
            context.res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            context.res.end(JSON.stringify({ message: "修改密码失败，请稍后再试。" }));
        }
    }
};
