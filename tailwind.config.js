// Tailwind CSS 本地构建配置（替代 templates/base.html 中的 Play CDN）。
// 重建命令（Node 环境）：
//   npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o static/css/tailwind.css --minify
// 生成的 static/css/tailwind.css 已提交仓库，运行时无需 Node / 网络。
module.exports = {
    content: [
        './templates/**/*.html',
        './static/js/**/*.js',
    ],
    theme: {
        extend: {
            colors: {
                base: 'var(--c-base)',
                surface: 'var(--c-surface)',
                border: 'var(--c-border)',
                accent: 'var(--c-accent)',
                'accent-dim': 'var(--c-accent-dim)',
                'text-primary': 'var(--c-text-primary)',
                'text-secondary': 'var(--c-text-secondary)',
                'text-muted': 'var(--c-text-muted)',
            },
            fontFamily: {
                mono: ['JetBrains Mono', 'Consolas', 'monospace'],
                sans: ['Noto Sans SC', 'system-ui', 'sans-serif'],
            },
        },
    },
    plugins: [],
};
