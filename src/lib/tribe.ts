export interface TribeMember {
  id: string;
  name: string;
  nameZh: string;
  firm: string;
  color: string;
  initials: string;
  aum?: string;
  materialLabel: string;
  materialSub: string;
  materialHref: string;
  holdingsHref: string;
  hasData: boolean;
  icon: string;
}

export const TRIBE_MEMBERS: TribeMember[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    nameZh: "巴菲特",
    firm: "Berkshire Hathaway",
    color: "#8b0000",
    initials: "巴",
    aum: "$294B",
    materialLabel: "信件档案",
    materialSub: "1958–2025",
    materialHref: "/master/buffett/library",
    holdingsHref: "/master/buffett/holdings",
    hasData: true,
    icon: "📝",
  },
  {
    id: "lilu",
    name: "Li Lu",
    nameZh: "李录",
    firm: "喜马拉雅资本",
    color: "#1d4ed8",
    initials: "李",
    aum: "$3.6B",
    materialLabel: "演讲材料",
    materialSub: "1997–至今",
    materialHref: "/master/lilu/materials",
    holdingsHref: "/master/lilu/holdings",
    hasData: true,
    icon: "🎙",
  },
  {
    id: "duan",
    name: "Duan Yongping",
    nameZh: "段永平",
    firm: "H&H International Investment",
    color: "#059669",
    initials: "段",
    aum: "$14.5B",
    materialLabel: "投资问答",
    materialSub: "2006–至今",
    materialHref: "/master/duan/materials",
    holdingsHref: "/master/duan/holdings",
    hasData: true,
    icon: "✍️",
  },
];

export function getTribeMember(id: string): TribeMember | null {
  return TRIBE_MEMBERS.find((m) => m.id === id) ?? null;
}
