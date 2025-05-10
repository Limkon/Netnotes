document.addEventListener('DOMContentLoaded', function () {
    const editorContainer = document.getElementById('editor-container');

    if (editorContainer) {
        const quill = new Quill('#editor-container', {
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                    [{ 'font': [] }],
                    [{ 'size': ['small', false, 'large', 'huge'] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }], // 字体颜色、背景颜色（标注）
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'list': 'check' }],
                    [{ 'script': 'sub'}, { 'script': 'super' }],
                    [{ 'indent': '-1'}, { 'indent': '+1' }],
                    [{ 'direction': 'rtl' }],
                    [{ 'align': [] }],
                    ['link', 'image', 'blockquote', 'code-block', 'video'], // 包含图片和视频上传按钮
                    ['clean']
                ],
                // Quill Image Compressor (optional, if you want client-side compression)
                // imageCompressor: {
                //     quality: 0.8, // default
                //     maxWidth: 1000, // default
                //     maxHeight: 1000, // default
                //     imageType: 'image/jpeg', // default
                //     debug: true, // default
                // },
            },
            theme: 'snow',
            placeholder: '在此输入您的精彩内容...'
        });

        // 将 Quill 编辑器的内容同步到隐藏的 input 字段，以便表单提交
        const noteForm = document.getElementById('note-form');
        if (noteForm) {
            // 加载已有内容到 Quill (如果 note.content 存在于隐藏字段或直接在 div 中)
            const quillContentInput = document.getElementById('quill-content');
            if (quillContentInput && quillContentInput.value) {
                 // quill.clipboard.dangerouslyPasteHTML(0, quillContentInput.value);
            } else if (editorContainer.innerHTML.trim() !== '<p><br></p>') {
                // 内容已由 EJS 渲染到 #editor-container
            }


            noteForm.addEventListener('submit', function() {
                if (quillContentInput) {
                    quillContentInput.value = quill.root.innerHTML;
                    // 检查内容是否为空（仅包含 <p><br></p>）
                    if (quill.getText().trim().length === 0 && quill.root.innerHTML === '<p><br></p>') {
                         // 可以选择将空内容设为空字符串，或后端处理
                         // quillContentInput.value = '';
                    }
                }
            });
        }

        // 自定义图片上传处理 (如果默认的 base64 不符合需求，或需要上传到服务器)
        // Quill 的默认图片处理是将其转换为 base64 嵌入。
        // 如果要上传到服务器，需要自定义图片处理器：
        quill.getModule('toolbar').addHandler('image', () => {
            selectLocalImage(quill);
        });
    }
});

function selectLocalImage(quillInstance) {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();

    input.onchange = async () => {
        const file = input.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('imageFile', file);

            // 显示加载指示 (可选)
            const range = quillInstance.getSelection(true);
            quillInstance.insertText(range.index, ' [上传中...] ', 'user');


            try {
                const response = await fetch('/notes/upload/image', { // 确认这是正确的上传路径
                    method: 'POST',
                    body: formData
                    // 注意：对于 FormData，浏览器会自动设置 Content-Type 为 multipart/form-data
                });

                // 移除加载指示
                const currentSelection = quillInstance.getSelection(true);
                if(currentSelection) { // 确保有选区
                    const loadingTextIndex = quillInstance.getText(0, currentSelection.index + 1).lastIndexOf(' [上传中...] ');
                    if (loadingTextIndex !== -1 && loadingTextIndex + ' [上传中...] '.length === currentSelection.index ) { // 避免误删
                         quillInstance.deleteText(loadingTextIndex, ' [上传中...] '.length, 'user');
                    }
                }


                if (response.ok) {
                    const result = await response.json();
                    // 插入图片到编辑器
                    const imageIndex = quillInstance.getSelection(true).index; // 获取当前光标位置
                    quillInstance.insertEmbed(imageIndex, 'image', result.imageUrl);
                    quillInstance.setSelection(imageIndex + 1); // 将光标移到图片之后
                } else {
                    const errorResult = await response.json();
                    console.error('Image upload failed:', errorResult.error || response.statusText);
                    alert('图片上传失败: ' + (errorResult.error || '服务器错误，请检查控制台。'));
                }
            } catch (error) {
                 // 尝试移除加载指示（如果还存在）
                const currentSelectionOnError = quillInstance.getSelection(true);
                 if(currentSelectionOnError) {
                    const loadingTextIndexOnError = quillInstance.getText(0, currentSelectionOnError.index + 1).lastIndexOf(' [上传中...] ');
                     if (loadingTextIndexOnError !== -1 && loadingTextIndexOnError + ' [上传中...] '.length === currentSelectionOnError.index ) {
                         quillInstance.deleteText(loadingTextIndexOnError, ' [上传中...] '.length, 'user');
                    }
                }
                console.error('Error uploading image:', error);
                alert('图片上传时发生网络错误或服务器无响应。');
            }
        }
    };
}
