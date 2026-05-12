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
}

export const TRIBE_MEMBERS: TribeMember[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    nameZh: "Warren Buffett",
    firm: "Berkshire Hathaway",
    color: "#8b0000",
    initials: "WB",
    aum: "$294B",
    materialLabel: "信件档案",
    materialSub: "1958–2025",
    materialHref: "/letters/shareholder/2024",
    holdingsHref: "/person/buffett/holdings",
    hasData: true,
  },
  {
    id: "lilu",
    name: "Li Lu",
    nameZh: "李录",
    firm: "喜马拉雅资本",
    color: "#1d4ed8",
    initials: "李录",
    aum: "$3.6B",
    materialLabel: "演讲材料",
    materialSub: "公开讲座",
    materialHref: "/person/lilu/materials",
    holdingsHref: "/person/lilu/holdings",
    hasData: false,
  },
  {
    id: "duan",
    name: "Duan Yongping",
    nameZh: "段永平",
    firm: "H&H International Investment",
    color: "#059669",
    initials: "段",
    materialLabel: "雪球帖子",
    materialSub: "公开言论",
    materialHref: "/person/duan/materials",
    holdingsHref: "/person/duan/holdings",
    hasData: false,
  },
];

export function getTribeMember(id: string): TribeMember | null {
  return TRIBE_MEMBERS.find((m) => m.id === id) ?? null;
}
