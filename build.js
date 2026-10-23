// Builds dist/index.html (standalone page for any static host) and dist/artifact.html (fragment for claude.ai Artifacts).
const fs = require('fs');
const read = (f) => fs.readFileSync(__dirname + '/src/' + f, 'utf8');
const js = ['engine.js', 'data.js', 'ai.js', 'workflow.js', 'files.js', 'app.js'].map(read).join('\n');
const css = read('app.css');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700&display=swap">';
const jszip = '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>';
// Optional: BS_API_URL=https://your-backend.vercel.app node build.js  (tells the page where the AI server lives)
const api = process.env.BS_API_URL ? '<script>window.BS_API_URL=' + JSON.stringify(process.env.BS_API_URL.replace(/\/+$/, '')) + ';</script>\n' : '';
const body = '<title>BrandSentinel</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + fonts + '\n<style>\n' + css + '\n</style>\n<div id="app"></div>\n' + jszip + '\n' + api + '<script>\n' + js + '\n</script>\n';
fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/artifact.html', body);
fs.writeFileSync(__dirname + '/dist/index.html', '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>\n' + body + '</body></html>\n');
console.log('built', (body.length / 1024).toFixed(0) + ' KB');