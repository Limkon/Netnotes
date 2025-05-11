// utils/fileStore.js
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid'; // 用于生成唯一ID

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const notesDir = path.resolve(process.platform === 'win32' ? __dirname.substring(1) : __dirname, '../data/notes'); // 处理 Windows 路径问题

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
      throw error; // Re-throw if it's not a "directory not found" error
    }
  }
}
// 在模块加载时调用一次，以确保目录存在
ensureNotesDir().catch(err => console.error("Failed to ensure notes directory on startup:", err));


export async function getAllNotes() {
  try {
    await ensureNotesDir(); // 确保目录存在
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
    if (error.code === 'ENOENT') { // 如果 notesDir 首次不存在（理论上已被 ensureNotesDir 处理）
        console.warn('Notes directory not found while getAllNotes, returning empty array.');
        return [];
    }
    console.error('Error reading notes:', error);
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
      return null; // 文件未找到
    }
    console.error(`Error reading note ${id}:`, error);
    throw error;
  }
}

export async function saveNote(noteData) {
  await ensureNotesDir();
  const id = noteData.id || uuidv4(); // 如果是新笔记，则生成 ID
  const note = {
    id: id,
    title: noteData.title,
    content: noteData.content || '',
    createdAt: noteData.id ? noteData.createdAt : new Date().toISOString(), // 保留原有创建时间或设为当前
    updatedAt: new Date().toISOString()
  };
  const filePath = path.join(notesDir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(note, null, 2), 'utf-8');
  return note;
}

export async function updateNote(id, noteData) {
  await ensureNotesDir();
  const existingNote = await getNoteById(id);
  if (!existingNote) {
    return null; // 或抛出错误
  }
  const updatedNote = {
    ...existingNote,
    ...noteData,
    id: id, // 确保 ID 不变
    updatedAt: new Date().toISOString()
  };
  const filePath = path.join(notesDir, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(updatedNote, null, 2), 'utf-8');
  return updatedNote;
}

export async function deleteNoteById(id) {
  await ensureNotesDir();
  const filePath = path.join(notesDir, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // 文件未找到，无法删除
    }
    console.error(`Error deleting note ${id}:`, error);
    throw error;
  }
}
