import express from 'express';
import methodOverride from 'method-override';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import noteRoutes from './routes/notes.js'; // 假设您有一个 notes.js 路由文件
import { ensureUploadsDir } from './utils/fileStore.js'; // 假设您有一个 fileStore.js 工具文件

// 配置 dotenv，使其能够加载 .env 文件中的环境变量
dotenv.config();

// 在 ES 模块中获取 __dirname 的等效值
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// 从环境变量 process.env.PORT 中读取端口号
// 如果环境变量中没有定义 PORT，则默认使用 8100
const PORT = process.env.PORT || 8100;

// 确保上传目录存在 (假设的函数)
// 您需要确保 ensureUploadsDir 函数的实现是正确的
ensureUploadsDir().catch(err => console.error("启动时确保上传目录失败:", err));


// 中间件设置
app.set('view engine', 'ejs'); // 设置视图引擎为 ejs
app.set('views', path.join(__dirname, 'views')); // 设置视图文件所在的目录
app.use(express.urlencoded({ extended: true })); // 解析 URL 编码的请求体
app.use(express.json()); // 解析 JSON 格式的请求体
app.use(methodOverride('_method')); // 允许通过查询参数覆盖 HTTP 方法 (例如用于 PUT, DELETE)
app.use(express.static(path.join(__dirname, 'public'))); // 提供静态文件服务 (例如 CSS, 客户端 JavaScript)

// 路由定义
app.get('/', (req, res) => {
  res.redirect('/notes'); // 根路径重定向到 /notes
});
app.use('/notes', noteRoutes); // /notes 相关的路由由 noteRoutes 处理

// 404 错误处理中间件
// 如果前面的路由都没有匹配到，则会执行此中间件
app.use((req, res, next) => {
  res.status(404).render('partials/404'); // 渲染 404 页面 (假设您有这个视图)
});

// 全局错误处理中间件 (更健壮的错误处理方式)
// 如果任何路由处理器中发生错误并调用了 next(err)，则会执行此中间件
app.use((err, req, res, next) => {
  console.error("全局错误处理器捕获到错误:", err.stack);
  res.status(500).send('服务器发生了一些错误！');
});


app.listen(PORT, () => {
  console.log(`服务器正在运行于 http://localhost:${PORT}`);
});
