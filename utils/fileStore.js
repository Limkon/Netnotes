import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 修正路径以正确处理 Windows 和其他平台
const projectRootDir = path.resolve(__dirname, '..'); // 项目根目录
const notesDir = path.join(projectRootDir, 'data', 'notes');
const uploadsDir = path.join(projectRootDir, 'public', 'uploads');


// 确保 notes 目录存在
async function ensureNotesDir() {
  try {
    await fs.access(notesDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(notesDir, { recursive: true });
      console.log(`Created directory: ${notesDir}`);
    } else {
      console.error('Error accessing notes directory:', error);
      throw error;
    }
  }
}

// 确保 public/uploads 目录存在
export async function ensureUploadsDir() {
  try {
    await fs.access(uploadsDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(uploadsDir, { recursive: true });
      console.log(`Created directory: ${uploadsDir}`);
    } else {
      console.error('Error accessing uploads directory:', error);
      throw error;
    }
  }
}


// 在模块加载时调用一次，以确保目录存在
ensureNotesDir().catch(err => console.error("Failed to ensure notes directory on startup:", err));
// ensureUploadsDir() is called from server.js to avoid circular dependency if fileStore needs something from server setup first.


export async function getAllNotes() {
  try {
    await ensureNotesDir();
    const files = await fs.readdir(notesDir);
    const notes = [];
    for (const file of files) {
      if (path.extname(file) === '.json') {
        const filePath = path.join(notesDir, file);
        const data = await fs.readFile(filePath, 'utf-8');
        notes.push(JSON.parse(data));
      }
    }
    return notes;
  } catch (error) {
    if (error.code === 'ENOENT') {
        console.warn('Notes directory not found while getAllNotes, returning empty array.');
        return [];
    }
    console.error('Error reading all notes:', error);
    throw error;
  }
}

export async function getNoteById(id) {
  const filePath = path.join(notesDir, `${id}.json`);
  try {
    await ensureNotesDir();
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    console.error(`Error reading note ${id}:`, error);
    throw error;
  }
}

export async function saveNote(noteData) {
  await ensureNotesDir();
  const id = noteData.id || uuidv4();
  const isNewNote = !noteData.id;

  const note = {
    id: id,
    title: noteData.title,
    content: noteData.content || '',
    createdAt: isNewNote ? new Date().toISOString() : noteData.createdAt, // 如果是新笔记，使用当前时间，否则保留旧的创建时间
    updatedAt: new Date().toISOString()
  };
  const filePath = path.join(notesDir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(note, null, 2), 'utf-8');
  return note;
}

export async function deleteNoteById(id) {
  await ensureNotesDir();
  const filePath = path.join(notesDir, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    console.error(`Error deleting note ${id}:`, error);
    throw error;
  }
}
