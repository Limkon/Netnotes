import express from 'express';
// import mongoose from 'mongoose'; // 移除
import methodOverride from 'method-override';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import noteRoutes from './routes/notes.js';

// 配置 dotenv
dotenv.config();

// __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 移除 MongoDB 连接
// const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/notepad_db';
// mongoose.connect(MONGODB_URI)
//   .then(() => console.log('MongoDB connected...'))
//   .catch(err => console.error('MongoDB connection error:', err));

// 中间件
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// 路由
app.get('/', (req, res) => {
  res.redirect('/notes');
});
app.use('/notes', noteRoutes);

// 404 错误处理
app.use((req, res) => {
  res.status(404).render('partials/404');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
