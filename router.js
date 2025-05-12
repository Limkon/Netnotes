// router.js - 请求路由处理
const url = require('url');
const querystring = require('querystring');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('./auth');
const userController = require('./userController');
const noteController = require('./noteController');
const { serveStaticFile, sendNotFound, redirect, sendForbidden, sendError, sendBadRequest, serveHtmlWithPlaceholders } = require('./responseUtils');
const storage = require('./storage');

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = storage.UPLOADS_DIR;

function parseMultipartFormData(rawBuffer, contentTypeHeader) {
    const boundaryMatch = contentTypeHeader.match(/boundary=(.+)/);
    if (!boundaryMatch) {
        console.warn("解析 multipart/form-data 失败：找不到 boundary。");
        return { fields: {}, files: {} };
    }
    const boundary = `--${boundaryMatch[1]}`;
    const result = { fields: {}, files: {} };
    let lastIndex = 0;
    let boundaryIndex = rawBuffer.indexOf(boundary, lastIndex);
    while (boundaryIndex !== -1) {
        let nextBoundaryIndex = rawBuffer.indexOf(boundary, boundaryIndex + boundary.length);
        if (nextBoundaryIndex === -1) break;
        const partStart = boundaryIndex + boundary.length + 2;
        const partEnd = nextBoundaryIndex - 2;
        if (partStart >= partEnd) {
            boundaryIndex = nextBoundaryIndex; continue;
        }
        const partBuffer = rawBuffer.subarray(partStart, partEnd);
        const separatorIndex = partBuffer.indexOf('\r\n\r\n');
        if (separatorIndex === -1) {
            boundaryIndex = nextBoundaryIndex; continue;
        }
        const headerBuffer = partBuffer.subarray(0, separatorIndex);
        const bodyBuffer = partBuffer.subarray(separatorIndex + 4);
        const headerString = headerBuffer.toString('utf-8');
        const dispositionLine = headerString.split('\r\n').find(line => line.toLowerCase().startsWith('content-disposition:'));
        if (!dispositionLine) {
            boundaryIndex = nextBoundaryIndex; continue;
        }
        const fieldNameMatch = dispositionLine.match(/name="([^"]+)"/i);
        if (!fieldNameMatch) {
            boundaryIndex = nextBoundaryIndex; continue;
        }
        const fieldName = fieldNameMatch[1];
        let originalFileName = "unknown_file.dat";
        const filenameStarMatch = dispositionLine.match(/filename\*=(utf-8|iso-8859-1)''([^;]+)/i);
        if (filenameStarMatch) {
            const encodedName = filenameStarMatch[2];
            try { originalFileName = decodeURIComponent(encodedName); }
            catch (e) { console.warn(`解碼 filename* 属性 "${encodedName}" 失败:`, e); originalFileName = "fallback_filename_decode_error.dat"; }
        } else {
            const filenameMatch = dispositionLine.match(/filename="((?:[^"\\]|\\.)*)"/i);
            if (filenameMatch) {
                let name = filenameMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                try { originalFileName = decodeURIComponent(name); }
                catch (e) { console.warn(`解码普通 filename 属性 "${name}" 失败:`, e); originalFileName = name; }
            }
        }
        if (dispositionLine.includes('filename=')) {
            const contentTypeMatch = headerString.match(/Content-Type: (.+)/i);
            const fileContentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
            result.files[fieldName] = { filename: originalFileName, contentType: fileContentType, content: bodyBuffer };
        } else {
            result.fields[fieldName] = bodyBuffer.toString('utf-8');
        }
        boundaryIndex = nextBoundaryIndex;
    }
    return result;
}


module.exports = {
    handleRequest: async (req, res, rawBuffer) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        const method = req.method.toUpperCase();
        const query = parsedUrl.query;
        const headers = req.headers;
        let body = {}; let files = {};

        if ((method === 'POST' || method === 'PUT') && rawBuffer && rawBuffer.length > 0) {
            const contentType = headers['content-type'] || '';
            if (contentType.includes('application/x-www-form-urlencoded')) {
                try { body = querystring.parse(rawBuffer.toString('utf8')); }
                catch (e) { return sendBadRequest(res, "请求体格式错误。"); }
            } else if (contentType.includes('application/json')) {
                try { body = JSON.parse(rawBuffer.toString('utf8')); }
                catch (e) { return sendBadRequest(res, "JSON 格式错误。"); }
            } else if (contentType.includes('multipart/form-data')) {
                try {
                    const parsedMultipart = parseMultipartFormData(rawBuffer, contentType);
                    body = parsedMultipart.fields; files = parsedMultipart.files;
                } catch (e) { console.error("解析 multipart/form-data 请求体错误:", e); return sendError(res, "处理上传文件时发生错误。"); }
            }
        }

        const context = { req, res, pathname, method, query, headers, body, files, rawBuffer, session: null };
        context.session = authenticate(req);

        if (method === 'GET') {
            if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
                const staticFilePath = path.join(PUBLIC_DIR, pathname);
                if (path.resolve(staticFilePath).startsWith(path.resolve(PUBLIC_DIR))) return serveStaticFile(res, staticFilePath);
                else return sendForbidden(res, "禁止访问此路径的静态资源。");
            }
            if (pathname.startsWith('/uploads/')) {
                // Step 1: 如果完全没有会话 (即 "anyone" 用户不存在且用户未登录)，则禁止访问。
                if (!context.session) {
                    return sendForbidden(res, "您需要登录或启用匿名访问才能下载附件。");
                }

                const requestedFileRelativePath = decodeURIComponent(pathname.substring('/uploads/'.length));
                const fullPath = path.join(UPLOADS_DIR, requestedFileRelativePath);

                // Step 2: 安全性 - 路径遍历检查 (始终重要)
                if (!path.resolve(fullPath).startsWith(path.resolve(UPLOADS_DIR))) {
                    return sendForbidden(res, "禁止访问此文件路径！");
                }

                // Step 3: 文件存在性检查
                if (!fs.existsSync(fullPath)) {
                    return sendNotFound(res, "请求的附件不存在。");
                }

                // Step 4: 权限检查
                // 如果是匿名用户 (通过 "anyone" 登录) 或管理员，则允许下载。
                // 如果是普通登录用户，则检查他们是否是该附件所属贴子的所有者。
                if (context.session.role !== 'anonymous' && context.session.role !== 'admin') {
                    const note = storage.getNotes().find(n => n.attachment && n.attachment.path === requestedFileRelativePath);
                    if (!note || note.userId !== context.session.userId) {
                         return sendForbidden(res, "您无权下载此附件。");
                    }
                }
                // 允许匿名用户、管理员或已验证所有权的普通用户下载
                return serveStaticFile(res, fullPath);
            }
        }

        if (pathname === '/login' && method === 'GET') return userController.getLoginPage(context);
        if (pathname === '/login' && method === 'POST') return userController.loginUser(context);
        if (pathname === '/register' && method === 'GET') return userController.getRegisterPage(context);
        if (pathname === '/api/users/register' && method === 'POST') return userController.registerUser(context);
        if (pathname === '/note/view' && method === 'GET') return noteController.getNoteViewPage(context);


        if (context.session && context.session.role === 'anonymous') {
            if ((pathname === '/' || pathname === '/index.html') && method === 'GET') return noteController.getNotesPage(context);
            if (pathname === '/api/notes' && method === 'GET') return noteController.getAllNotes(context);
            // /note/view GET 已在上面处理
            
            // 匿名用户不能访问API获取单个笔记数据 (getNoteById)
            if (pathname.startsWith('/api/notes/') && method === 'GET' && pathname.split('/').length > 3) { // 避免匹配 /api/notes
                return sendForbidden(res, "匿名用户无权直接访问此API。");
            }

            if (method !== 'GET' || (pathname !== '/' && pathname !== '/index.html' && pathname !== '/note/view' && pathname !== '/api/notes')) {
                if (pathname.startsWith('/api/')) return sendForbidden(res, "匿名用户无权执行此操作。");
                return redirect(res, '/login');
            }
        }

        if (!context.session || context.session.role === 'anonymous') {
            // 对于 /api/notes，如果匿名访问未启用 (context.session 为 null)，则禁止
            if (pathname === '/api/notes' && !context.session) {
                 return sendUnauthorized(res, "请先登录后再操作。");
            }
            if (pathname.startsWith('/api/') && pathname !== '/api/notes') { 
                 return sendUnauthorized(res, "请先登录后再操作。");
            }
            if (!pathname.startsWith('/api/') && pathname !== '/login' && pathname !== '/register' && pathname !== '/note/view' && pathname !== '/' && pathname !== '/index.html') {
                 return redirect(res, '/login');
            }
            if (!context.session && (pathname === '/' || pathname === '/index.html' || pathname === '/note/view')) {
                return redirect(res, '/login');
            }
        }

        if (pathname === '/logout' && method === 'POST') return userController.logoutUser(context);
        if (pathname === '/change-password' && method === 'GET') return userController.getChangePasswordPage(context);
        if (pathname === '/api/users/me/password' && method === 'POST') return userController.changeOwnPassword(context);
        if ((pathname === '/' || pathname === '/index.html') && method === 'GET') return noteController.getNotesPage(context);
        if (pathname === '/api/notes' && method === 'GET') return noteController.getAllNotes(context);
        if (pathname === '/api/notes' && method === 'POST') return noteController.createNote(context);
        if (pathname.startsWith('/api/notes/') && method === 'GET') return noteController.getNoteById(context);
        if (pathname.startsWith('/api/notes/') && method === 'PUT') return noteController.updateNote(context);
        if (pathname.startsWith('/api/notes/') && method === 'DELETE') return noteController.deleteNoteById(context);
        if (pathname === '/note/new' && method === 'GET') return noteController.getNoteFormPage(context, null);
        if (pathname === '/note/edit' && method === 'GET') {
            if (!query.id) return sendBadRequest(res, "缺少贴子 ID 进行编辑。");
            return noteController.getNoteFormPage(context, query.id);
        }

        if (context.session && context.session.role === 'admin') {
            if (pathname === '/admin/users' && method === 'GET') return userController.getAdminUsersPage(context);
            if (pathname === '/api/admin/users' && method === 'GET') return userController.listAllUsers(context);
            if (pathname === '/api/admin/users' && method === 'POST') return userController.createUserByAdmin(context);
            if (pathname.startsWith('/api/admin/users/') && pathname.endsWith('/password') && method === 'PUT') {
                return userController.updateUserPasswordByAdmin(context);
            }
            if (pathname.startsWith('/api/admin/users/') && method === 'DELETE') return userController.deleteUserByAdmin(context);
        } else {
            if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
                return sendForbidden(res, "您没有权限访问此管理员功能。");
            }
        }

        return sendNotFound(res, `请求的路径 ${pathname} 未找到。`);
    }
};
