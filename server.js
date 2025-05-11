import express from 'express';
import methodOverride from 'method-override';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import noteRoutes from './routes/notes.js';
import { ensureUploadsDir } from './utils/fileStore.js'; // 确保上传目录的函数

// 配置 dotenv
dotenv.config();

// __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3100; // 使用 .env 中的端口或默认 8100  process.env.PORT ||

// 确保上传目录存在
ensureUploadsDir().catch(err => console.error("Failed to ensure uploads directory on startup:", err));


// 中间件
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public'))); // 静态文件服务

// 路由
app.get('/', (req, res) => {
  res.redirect('/notes');
});
app.use('/notes', noteRoutes);

// 404 错误处理
app.use((req, res, next) => {
  res.status(404).render('partials/404');
});

// 全局错误处理 (可选, 更健壮的错误处理)
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  res.status(500).send('Something broke!');
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
