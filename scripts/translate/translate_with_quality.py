#!/usr/bin/env python3
"""
高质量巴菲特致股东信翻译脚本
结合AI翻译和人工校对原则，确保最高质量的翻译输出
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import hashlib

# 翻译质量检查模块
class TranslationQualityChecker:
    """翻译质量检查器"""
    
    # 巴菲特股东信专用术语表
    BERKSHIRE_TERMS = {
        # 公司名称
        "Berkshire Hathaway": "伯克希尔·哈撒韦",
        "Berkshire": "伯克希尔",
        "BNSF": "BNSF铁路",
        "BHE": "伯克希尔哈撒韦能源公司",
        "GEICO": "GEICO保险公司",
        
        # 人物名称
        "Warren Buffett": "沃伦·巴菲特",
        "Charlie Munger": "查理·芒格",
        "Greg Abel": "格雷格·阿贝尔",
        "Ajit Jain": "阿吉特·贾恩",
        "Ben Graham": "本·格雷厄姆",
        
        # 金融术语
        "GAAP": "GAAP（美国通用会计准则）",
        "float": "浮存金",
        "retained earnings": "留存收益",
        "operating earnings": "经营收益",
        "net earnings": "净利润",
        "book value": "账面价值",
        "intrinsic value": "内在价值",
        "market value": "市场价值",
        "dividend": "股息",
        "share repurchase": "股票回购",
        "capital allocation": "资本配置",
        "underwriting profit": "承保利润",
        
        # 公司名称（投资组合）
        "Apple": "苹果公司",
        "Coca-Cola": "可口可乐",
        "American Express": "美国运通",
        "Bank of America": "美国银行",
        "Occidental Petroleum": "西方石油公司",
        
        # 日本公司
        "Itochu": "伊藤忠商事",
        "Marubeni": "丸红",
        "Mitsubishi": "三菱商事",
        "Mitsui": "三井物产",
        "Sumitomo": "住友商事",
    }
    
    # 常见翻译问题模式
    PROBLEM_PATTERNS = {
        r"(\d+)\s*(billion|million)": lambda m: f"{m.group(1)}{'亿' if m.group(2) == 'billion' else '万'}",
        r"\$\s*(\d+(?:,\d+)*)": lambda m: f"{m.group(1).replace(',', '')}美元",
        r"(\d+)%": lambda m: f"{m.group(1)}%",
    }
    
    @classmethod
    def check_consistency(cls, text_en: str, text_zh: str) -> List[str]:
        """检查翻译一致性"""
        issues = []
        
        # 检查术语一致性
        for term_en, term_zh in cls.BERKSHIRE_TERMS.items():
            if term_en in text_en and term_zh not in text_zh:
                # 检查是否可能是缩写或其他形式
                if not cls._is_variant_form(term_en, text_en):
                    issues.append(f"术语不一致: '{term_en}' 应翻译为 '{term_zh}'")
        
        # 检查数字和货币
        for pattern, replacement in cls.PROBLEM_PATTERNS.items():
            matches_en = re.findall(pattern, text_en)
            if matches_en:
                # 简化检查：确保数字在翻译中出现
                for match in matches_en:
                    if isinstance(match, tuple):
                        num_part = match[0]
                    else:
                        num_part = match
                    
                    if num_part not in text_zh:
                        issues.append(f"数字可能未正确翻译: {match}")
        
        return issues
    
    @staticmethod
    def _is_variant_form(term: str, text: str) -> bool:
        """检查是否是变体形式"""
        # 例如：Berkshire可能是"Berkshire's"等形式
        return re.search(rf"\b{re.escape(term)}['s]?\b", text) is not None
    
    @classmethod
    def calculate_quality_score(cls, text_en: str, text_zh: str) -> float:
        """计算翻译质量分数（0-100）"""
        score = 100.0
        
        # 扣分项
        issues = cls.check_consistency(text_en, text_zh)
        score -= len(issues) * 5  # 每个问题扣5分
        
        # 检查长度比例（中英文长度比通常在1.5-2.5之间为合理）
        len_ratio = len(text_zh) / max(len(text_en), 1)
        if len_ratio < 1.0 or len_ratio > 3.0:
            score -= 10
        
        # 检查标点符号完整性
        if text_en.endswith(('.', '!', '?')) and not text_zh.endswith(('。', '！', '？')):
            score -= 5
        
        return max(0, score)

# 翻译后处理模块
class TranslationPostProcessor:
    """翻译后处理器，优化翻译质量"""
    
    @staticmethod
    def fix_common_issues(text_zh: str) -> str:
        """修复常见翻译问题"""
        # 修复引号
        text_zh = text_zh.replace('"', '「').replace('"', '」')
        text_zh = text_zh.replace("'", "『").replace("'", "』")
        
        # 修复空格
        text_zh = re.sub(r'\s+', ' ', text_zh).strip()
        
        # 修复标点
        text_zh = re.sub(r'([。！？])([^\s])', r'\1 \2', text_zh)
        
        return text_zh
    
    @staticmethod
    def add_translation_notes(text_zh: str, notes: List[str]) -> str:
        """添加翻译说明"""
        if notes:
            notes_text = "\n".join([f"# {note}" for note in notes])
            return f"{text_zh}\n\n{notes_text}"
        return text_zh

# 主翻译引擎（模拟 - 实际应调用AI API）
class TranslationEngine:
    """翻译引擎（模拟版本，实际应集成AI API）"""
    
    @staticmethod
    def translate_batch(texts_en: List[Tuple[int, str]], year: int) -> Dict[int, str]:
        """
        批量翻译
        返回：{order: translated_text}
        
        注意：这是模拟版本，实际应该调用AI API
        """
        print(f"  [模拟翻译] 正在翻译 {len(texts_en)} 个段落...")
        
        # 这里应该是实际的AI API调用
        # 为了演示，我们返回模拟翻译
        translations = {}
        for order, text_en in texts_en:
            # 模拟翻译过程
            text_zh = f"[模拟翻译] {text_en[:50]}..."
            translations[order] = text_zh
        
        return translations
    
    @staticmethod
    def get_translation_guidelines(year: int) -> str:
        """获取年份特定的翻译指南"""
        guidelines = {
            2023: "这是2023年致股东信，重点纪念查理·芒格。翻译时应体现对芒格的敬意和怀念，保持庄重而温暖的语气。",
            2022: "这是2022年致股东信，关注经济不确定性和市场波动。翻译时应体现谨慎乐观的态度。",
            2021: "这是2021年致股东信，关注疫情后的经济复苏。翻译时应体现希望和韧性的主题。",
            2020: "这是2020年致股东信，关注疫情冲击。翻译时应体现危机应对和长期主义的主题。",
        }
        
        return guidelines.get(year, "这是巴菲特致股东信的翻译，应保持专业、清晰、富有智慧的语气，体现价值投资哲学。")

# 主翻译流程
class BerkshireTranslator:
    """伯克希尔致股东信翻译器"""
    
    def __init__(self, output_dir: str = "quality_reports"):
        self.quality_checker = TranslationQualityChecker()
        self.post_processor = TranslationPostProcessor()
        self.translation_engine = TranslationEngine()
        self.output_dir = output_dir
        
        os.makedirs(output_dir, exist_ok=True)
    
    def translate_year(self, year: int, input_path: str, output_path: str):
        """翻译指定年份的信件"""
        print(f"\n{'='*60}")
        print(f"开始翻译 {year} 年巴菲特致股东信")
        print(f"{'='*60}")
        
        # 读取原始数据
        with open(input_path, 'r', encoding='utf-8') as f:
            sections = json.load(f)
        
        print(f"总段落数: {len(sections)}")
        
        # 准备翻译
        texts_to_translate = []
        for section in sections:
            order = section["order"]
            content_en = section.get("content_en", "").strip()
            sec_type = section.get("type", "text")
            
            if content_en and content_en != "[TABLE DATA]" and sec_type != "table":
                texts_to_translate.append((order, content_en))
        
        print(f"需要翻译的段落数: {len(texts_to_translate)}")
        
        # 批量翻译
        translations = self.translation_engine.translate_batch(texts_to_translate, year)
        
        # 创建翻译报告
        quality_report = self._create_quality_report(sections, translations, year)
        
        # 生成最终翻译文件
        self._generate_final_translation(sections, translations, output_path, quality_report)
        
        print(f"\n✅ {year} 年翻译完成")
        print(f"   输出文件: {output_path}")
        print(f"   质量报告: {os.path.join(self.output_dir, f'quality_report_{year}.md')}")
    
    def _create_quality_report(self, sections: List[Dict], translations: Dict[int, str], year: int) -> Dict:
        """创建翻译质量报告"""
        report = {
            "year": year,
            "timestamp": datetime.now().isoformat(),
            "total_sections": len(sections),
            "translated_sections": len(translations),
            "quality_scores": [],
            "issues": [],
            "recommendations": []
        }
        
        # 分析每个翻译段落
        for section in sections:
            order = section["order"]
            content_en = section.get("content_en", "")
            content_zh = translations.get(order, "")
            
            if content_en and content_en != "[TABLE DATA]" and content_zh:
                # 计算质量分数
                score = self.quality_checker.calculate_quality_score(content_en, content_zh)
                report["quality_scores"].append({
                    "order": order,
                    "score": score,
                    "length_en": len(content_en),
                    "length_zh": len(content_zh)
                })
                
                # 检查问题
                issues = self.quality_checker.check_consistency(content_en, content_zh)
                if issues:
                    report["issues"].append({
                        "order": order,
                        "issues": issues
                    })
        
        # 计算平均分
        if report["quality_scores"]:
            avg_score = sum(item["score"] for item in report["quality_scores"]) / len(report["quality_scores"])
            report["average_score"] = avg_score
        else:
            report["average_score"] = 0
        
        # 生成建议
        self._generate_recommendations(report)
        
        # 保存报告
        report_path = os.path.join(self.output_dir, f"quality_report_{year}.md")
        self._save_quality_report(report, report_path)
        
        return report
    
    def _generate_recommendations(self, report: Dict):
        """生成改进建议"""
        if report["issues"]:
            report["recommendations"].append("建议检查术语一致性")
        
        if report.get("average_score", 0) < 80:
            report["recommendations"].append("建议进行人工校对")
        
        # 检查长度比例
        for item in report["quality_scores"]:
            ratio = item["length_zh"] / max(item["length_en"], 1)
            if ratio < 1.0:
                report["recommendations"].append("部分段落翻译可能过于简略")
                break
            elif ratio > 3.0:
                report["recommendations"].append("部分段落翻译可能过于冗长")
                break
    
    def _save_quality_report(self, report: Dict, report_path: str):
        """保存质量报告为Markdown文件"""
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(f"# {report['year']}年巴菲特致股东信翻译质量报告\n\n")
            f.write(f"生成时间: {report['timestamp']}\n\n")
            
            f.write("## 翻译统计\n")
            f.write(f"- 总段落数: {report['total_sections']}\n")
            f.write(f"- 已翻译段落: {report['translated_sections']}\n")
            f.write(f"- 平均质量分数: {report.get('average_score', 0):.1f}/100\n\n")
            
            if report["issues"]:
                f.write("## 发现的问题\n")
                for issue_group in report["issues"]:
                    f.write(f"### 段落 {issue_group['order']}\n")
                    for issue in issue_group["issues"]:
                        f.write(f"- {issue}\n")
                    f.write("\n")
            
            if report["recommendations"]:
                f.write("## 改进建议\n")
                for rec in report["recommendations"]:
                    f.write(f"- {rec}\n")
                f.write("\n")
            
            f.write("## 质量分数分布\n")
            f.write("| 段落 | 质量分数 | 英文长度 | 中文长度 |\n")
            f.write("|------|----------|----------|----------|\n")
            for item in report["quality_scores"]:
                f.write(f"| {item['order']} | {item['score']:.1f} | {item['length_en']} | {item['length_zh']} |\n")
    
    def _generate_final_translation(self, sections: List[Dict], translations: Dict[int, str], 
                                   output_path: str, quality_report: Dict):
        """生成最终翻译文件"""
        translated_sections = []
        
        for section in sections:
            order = section["order"]
            content_en = section.get("content_en", "")
            sec_type = section.get("type", "text")
            
            # 创建新的section
            new_section = dict(section)
            
            # 处理不同类型的段落
            if sec_type == "table" and content_en == "[TABLE DATA]":
                new_section["content_zh"] = "[表格数据]"
            elif order in translations:
                # 应用翻译
                translated = translations[order]
                # 后处理
                translated = self.post_processor.fix_common_issues(translated)
                new_section["content_zh"] = translated
            else:
                # 未翻译的段落
                new_section["content_zh"] = content_en
            
            # 添加质量信息（仅用于调试）
            if "meta" not in new_section:
                new_section["meta"] = {}
            
            if order in translations:
                score = next((item["score"] for item in quality_report["quality_scores"] 
                            if item["order"] == order), 0)
                new_section["meta"]["translation_score"] = score
            
            translated_sections.append(new_section)
        
        # 保存文件
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(translated_sections, f, ensure_ascii=False, indent=2)
        
        print(f"   已保存翻译文件: {output_path}")

# 命令行接口
def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="高质量巴菲特致股东信翻译工具")
    parser.add_argument("years", nargs="+", type=int, help="要翻译的年份（例如：2023 2022）")
    parser.add_argument("--input-dir", default="data/parsed", help="输入目录")
    parser.add_argument("--output-dir", default="data/parsed", help="输出目录")
    parser.add_argument("--quality-reports", default="quality_reports", help="质量报告目录")
    
    args = parser.parse_args()
    
    # 创建翻译器
    translator = BerkshireTranslator(output_dir=args.quality_reports)
    
    # 翻译每个年份
    for year in args.years:
        input_path = os.path.join(args.input_dir, str(year), "sections.json")
        output_path = os.path.join(args.output_dir, str(year), "sections_zh.json")
        
        if not os.path.exists(input_path):
            print(f"⚠️ 未找到输入文件: {input_path}")
            continue
        
        # 确保输出目录存在
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        try:
            translator.translate_year(year, input_path, output_path)
        except Exception as e:
            print(f"❌ 翻译 {year} 年时出错: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()