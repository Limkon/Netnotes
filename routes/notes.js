import express from 'express';
import multer from 'multer';
import path from 'path';
import {
  getAllNotes,
  getNoteById,
  saveNote,
  deleteNoteById
} from '../utils/fileStore.js';

const router = express.Router();

// Multer 配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // 确保上传目录存在 (虽然 server.js 也会检查，这里作为双重保障或特定路由需求)
    // import { ensureUploadsDir } from '../utils/fileStore.js'; // 如果需要在这里也确保
    // ensureUploadsDir().then(() => cb(null, 'public/uploads/')).catch(err => cb(err));
    cb(null, 'public/uploads/'); // 假设目录已由 server.js 或 fileStore.js 初始化时创建
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 文件大小限制
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  }
});

function checkFileType(file, cb) {
  const filetypes = /jpeg|jpg|png|gif|webp/; // 添加 webp 支持
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Error: Images Only! (jpeg, jpg, png, gif, webp)')); // 向 cb 传递 Error 对象
  }
}

// --- HTML 渲染路由 ---

// GET /notes - 显示所有记事 (主页)
router.get('/', async (req, res, next) => {
  try {
    let notes = await getAllNotes();
    const { sortBy = 'updatedAt', order = 'desc', title = '' } = req.query;

    if (title) {
        notes = notes.filter(note => note.title && note.title.toLowerCase().includes(title.toLowerCase()));
    }

    notes.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        valA = new Date(valA);
        valB = new Date(valB);
      } else if (typeof valA === 'string' && typeof valB === 'string') { // 确保都是字符串再比较
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      } else if (valA === undefined || valA === null) valA = ''; // 处理 undefined 或 null
      else if (valB === undefined || valB === null) valB = '';


      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });

    res.render('index', { notes, currentSort: { sortBy, order }, currentTitle: title });
  } catch (err) {
    next(err); // 交给全局错误处理器
  }
});

// GET /notes/new - 显示新建记事的表单
router.get('/new', (req, res) => {
  res.render('new', { note: { title: '', content: '' }, error: null });
});

// GET /notes/:id/edit - 显示编辑记事的表单
router.get('/:id/edit', async (req, res, next) => {
  try {
    const note = await getNoteById(req.params.id);
    if (!note) {
      return res.status(404).render('partials/404');
    }
    res.render('edit', { note, error: null });
  } catch (err) {
    next(err);
  }
});

// GET /notes/:id - 显示单个记事
router.get('/:id', async (req, res, next) => {
  try {
    const note = await getNoteById(req.params.id);
    if (!note) {
      return res.status(404).render('partials/404');
    }
    res.render('show', { note });
  } catch (err) {
    next(err);
  }
});


// --- API 操作路由 ---

// POST /notes - 创建新记事
router.post('/', async (req, res, next) => {
  const { title, content } = req.body;
  if (!title || title.trim() === '') {
    return res.render('new', {
        note: { title, content },
        error: '标题是必填项。'
    });
  }
  try {
    await saveNote({ title, content });
    res.redirect('/notes');
  } catch (err) {
    // next(err); // 可以选择全局处理，或局部处理
     res.render('new', { note: { title, content }, error: '创建记事失败，请稍后再试。' });
  }
});

// PUT /notes/:id - 更新记事
router.put('/:id', async (req, res, next) => {
  const { title, content } = req.body;
  const id = req.params.id;
  if (!title || title.trim() === '') {
    const note = await getNoteById(id); // 获取当前笔记以便回填
    return res.render('edit', {
        note: { ...note, title, content }, // 使用用户提交的 title 和 content 预填充
        error: '标题是必填项。'
    });
  }
  try {
    const existingNote = await getNoteById(id);
    if (!existingNote) {
      return res.status(404).render('partials/404');
    }
    await saveNote({ id, title, content, createdAt: existingNote.createdAt });
    res.redirect('/notes');
  } catch (err) {
    // next(err);
    const noteForEdit = await getNoteById(id) || {id, title:'', content:''}; // 尝试获取，失败则用现有数据
    res.render('edit', { note: {...noteForEdit, title, content }, error: '更新记事失败，请稍后再试。' });
  }
});

// DELETE /notes/:id - 删除记事
router.delete('/:id', async (req, res, next) => {
  try {
    const success = await deleteNoteById(req.params.id);
    if (!success) {
      return res.status(404).render('partials/404');
    }
    res.redirect('/notes');
  } catch (err) {
    next(err);
  }
});

// POST /notes/upload/image - 图片上传 API
router.post('/upload/image', (req, res) => {
    upload.single('imageFile')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            // Multer 错误 (例如文件过大)
            console.error('Multer error:', err.message);
            return res.status(400).json({ error: `文件上传错误: ${err.message}` });
        } else if (err) {
            // 其他错误 (例如文件类型不对)
            console.error('File filter error or other:', err.message);
            return res.status(400).json({ error: err.message });
        }

        // 一切正常
        if (!req.file) {
            return res.status(400).json({ error: '未选择任何文件或文件类型不受支持。' });
        }
        const imageUrl = `/uploads/${req.file.filename}`;
        res.status(200).json({ imageUrl: imageUrl });
    });
});

export default router;
