- 支持[alwaysdata](https://www.alwaysdata.com/en/)空间一键安装，SSH登陆后执行以下命令，安装完成后在alwaysdata空间设置中找到Command*添加node server.js
     ```bash
     bash <(curl -fsSL https://raw.githubusercontent.com/Limkon/Netnotes/master/setup.sh)
     ```

notepad-nodejs-localfile/  
├── data/  
│   └── notes/         # 记事 JSON 文件将存储在这里 (由程序自动创建)  
├── public/  
│   ├── css/  
│   │   └── style.css  
│   ├── js/  
│   │   └── script.js  
│   └── uploads/       # 图片上传目录 (你需要手动创建此目录)  
├── views/  
│   ├── partials/  
│   │   ├── header.ejs  
│   │   ├── footer.ejs  
│   │   └── 404.ejs  
│   ├── index.ejs  
│   ├── new.ejs  
│   ├── edit.ejs  
│   └── show.ejs  
├── routes/  
│   └── notes.js  
├── utils/  
│   └── fileStore.js  
├── server.js  
├── package.json  
└── .env  
