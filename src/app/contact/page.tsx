import Link from "next/link";

export default function Contact() {
  return (
    <div className="container">
      <h1 className="letter-title">联系我们</h1>
      <div className="contact-content">
        <p>欢迎通过以下方式联系我们：</p>

        <h2>GitHub</h2>
        <p>如果您发现了bug或者有功能建议，请在 GitHub 仓库提交 Issue：</p>
        <p>
          <a 
            href="https://github.com/rafael/learn-from-buffett" 
            target="_blank" 
            rel="noopener noreferrer"
            className="link-primary"
          >
            github.com/rafael/learn-from-buffett
          </a>
        </p>

        <h2>项目介绍</h2>
        <p>Learn from Buffett 是一个开源教育项目，目标是让价值投资者能够更好地学习沃伦·巴菲特的投资理念。</p>

        <p>我们相信：通过理解历史背景，能更好地理解巴菲特的决策过程。</p>

        <h2>数据来源</h2>
        <ul>
          <li>巴菲特致股东信原文：Berkshire Hathaway 官方网站</li>
          <li>市场数据：Yahoo Finance</li>
          <li>持仓数据：SEC EDGAR</li>
        </ul>

        <p>本项目仅供学习研究使用。</p>
      </div>

      <div className="letter-footer">
        <hr />
        <Link href="/" className="back-link">返回首页</Link>
      </div>
    </div>
  );
}
