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
                // 注意：必须用 rgb(var(--x-rgb) / <alpha-value>) 形式，
                // 否则 Tailwind 3.x 无法为纯 var() 颜色生成 /10、/20 等透明度类（会静默缺失）。
                // 新增颜色时需在 static/css/style.css 的两个主题块中同步维护 --c-x-rgb。
                base: 'rgb(var(--c-base-rgb) / <alpha-value>)',
                surface: 'rgb(var(--c-surface-rgb) / <alpha-value>)',
                border: 'rgb(var(--c-border-rgb) / <alpha-value>)',
                accent: 'rgb(var(--c-accent-rgb) / <alpha-value>)',
                'accent-dim': 'rgb(var(--c-accent-dim-rgb) / <alpha-value>)',
                'text-primary': 'rgb(var(--c-text-primary-rgb) / <alpha-value>)',
                'text-secondary': 'rgb(var(--c-text-secondary-rgb) / <alpha-value>)',
                'text-muted': 'rgb(var(--c-text-muted-rgb) / <alpha-value>)',
            },
            fontFamily: {
                mono: ['JetBrains Mono', 'Consolas', 'monospace'],
                sans: ['Noto Sans SC', 'system-ui', 'sans-serif'],
            },
        },
    },
    plugins: [],
};
