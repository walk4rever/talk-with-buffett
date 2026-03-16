export default function Contact() {
  return (
    <div className="container">
      <h1>联系我们</h1>
      
      <h2>反馈与建议</h2>
      <p>我们非常重视您的反馈！如果您有任何改进建议、功能需求或遇到问题，请通过以下方式联系我们：</p>
      
      <ul>
        <li><strong>邮箱：</strong> contact@learnfrombuffett.com</li>
        <li><strong>GitHub：</strong> 提交 issue 或 pull request</li>
      </ul>
      
      <h2>技术支持</h2>
      <p>如果遇到登录、页面加载或其他技术问题，请先尝试：</p>
      <ol>
        <li>清除浏览器缓存和Cookie</li>
        <li>确保JavaScript已启用</li>
        <li>使用最新版主流浏览器</li>
      </ol>
      
      <h2>合作机会</h2>
      <p>如果您对金融数据分析、AI应用或教育科技有兴趣，欢迎交流探讨。</p>
      
      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'var(--secondary)', borderRadius: '8px' }}>
        <p><strong>注意：</strong>本项目仅供学习研究使用，不构成投资建议。</p>
      </div>
    </div>
  );
}