// responseUtils.js - HTTP响应辅助函数
const fs =require('fs');
const path = require('path');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
};

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

module.exports = {
    sendResponse: (res, content, contentType = 'text/plain; charset=utf-8', statusCode = 200) => {
        res.writeHead(statusCode, { 'Content-Type': contentType });
        res.end(content);
    },
    serveJson: (res, data, statusCode = 200) => {
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
    },
    redirect: (res, url, statusCode = 302) => { 
        res.writeHead(statusCode, { 'Location': url });
        res.end();
    },
    sendNotFound: (res, message = '404 - 资源未找到') => {
        if (res.writable && !res.headersSent) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: message }));
        } else {
            console.error("[RESPONSE_UTILS] sendNotFound: Headers already sent or stream not writable.");
        }
    },
    sendError: (res, message = '500 - 服务器内部错误', statusCode = 500) => {
        console.error(`[RESPONSE_UTILS] 服务器错误: ${message} (状态码: ${statusCode})`); // 保留此错误日志
        if (res.writable && !res.headersSent) {
            res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: message }));
        } else {
            console.error("[RESPONSE_UTILS] sendError: Headers already sent or stream not writable.");
        }
    },
    sendBadRequest: (res, message = '400 - 错误的请求') => {
        if (res.writable && !res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: message }));
        } else {
             console.error("[RESPONSE_UTILS] sendBadRequest: Headers already sent or stream not writable.");
        }
    },
    sendUnauthorized: (res, message = '401 - 未授权') => {
        if (res.writable && !res.headersSent) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: message }));
        } else {
            console.error("[RESPONSE_UTILS] sendUnauthorized: Headers already sent or stream not writable.");
        }
    },
    sendForbidden: (res, message = '403 - 禁止访问') => {
        if (res.writable && !res.headersSent) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: message }));
        } else {
            console.error("[RESPONSE_UTILS] sendForbidden: Headers already sent or stream not writable.");
        }
    },
    serveStaticFile: (res, filePath) => {
        const fullPath = path.resolve(filePath);
        const uploadsDir = require('./storage').UPLOADS_DIR; 
        if (!fullPath.startsWith(path.resolve(__dirname, 'public')) && !fullPath.startsWith(path.resolve(uploadsDir))) {
            // console.warn(`[RESPONSE_UTILS] Attempt to access illegal path (static file): ${fullPath}`); // 可选保留
            return module.exports.sendForbidden(res, "禁止访问此文件路径。");
        }

        fs.readFile(fullPath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    // console.warn(`[RESPONSE_UTILS] 静态文件未找到: ${fullPath}`); // 可选保留
                    return module.exports.sendNotFound(res, `文件 ${path.basename(fullPath)} 未找到`);
                } else {
                    // console.error(`[RESPONSE_UTILS] 读取静态文件 ${fullPath} 错误:`, err); // 可选保留
                    return module.exports.sendError(res, `读取文件 ${path.basename(fullPath)} 时发生服务器错误`);
                }
            }
            const contentType = getContentType(fullPath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        });
    },
    serveHtmlWithPlaceholders: (res, htmlFilePath, placeholders = {}, statusCode = 200) => {
        fs.readFile(htmlFilePath, 'utf8', (err, html) => {
            if (err) {
                // console.error(`[serveHtml] 读取 HTML 文件 ${htmlFilePath} 错误:`, err); // 可选保留
                return module.exports.sendError(res, `加载页面 ${path.basename(htmlFilePath)} 时发生错误`);
            }
            let renderedHtml = html;
            
            let iterations = 0;
            const MAX_ITERATIONS = 10; 
            let changedInThisPass;

            do {
                let htmlBeforeThisPass = renderedHtml;
                changedInThisPass = false;
                iterations++;
                
                const conditionalRegex = new RegExp(
                    '\\{\\{#if\\s*([a-zA-Z0-9_]+)\\s*\\}\\}((?:(?!\\{\\{\\#if)[\\s\\S])*?)\\{\\{\\/if\\s*\\}\\}', 
                    'g'
                );
                
                renderedHtml = renderedHtml.replace(conditionalRegex, (match, conditionKey, content) => {
                    const conditionValue = placeholders[conditionKey];
                    const isTruthy = conditionValue !== undefined && !!conditionValue; 
                    if (isTruthy) {
                        return content;
                    } else {
                        return ''; 
                    }
                });

                if (renderedHtml !== htmlBeforeThisPass) {
                    changedInThisPass = true;
                }
            } while (changedInThisPass && iterations < MAX_ITERATIONS);
            
            if (iterations >= MAX_ITERATIONS && changedInThisPass) {
                console.warn(`[serveHtml] 条件处理可能达到最大迭代次数 (${MAX_ITERATIONS})。 文件: ${htmlFilePath}`); // 保留此警告
            }

            for (const key in placeholders) {
                if (placeholders.hasOwnProperty(key)) { 
                    const valueToReplace = (placeholders[key] === null || placeholders[key] === undefined) ? '' : String(placeholders[key]);
                    
                    const tripleBraceRegex = new RegExp(`\\{\\{\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}\\}`, 'g');
                    if (tripleBraceRegex.test(renderedHtml)) {
                        renderedHtml = renderedHtml.replace(tripleBraceRegex, valueToReplace);
                    } else {
                        const doubleBraceRegex = new RegExp(`\\{\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`, 'g');
                        renderedHtml = renderedHtml.replace(doubleBraceRegex, valueToReplace);
                    }
                }
            }

            res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderedHtml);
        });
    }
};
