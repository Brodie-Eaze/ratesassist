"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

const ACCENT = "#1a52d4";
const SUCCESS = "#10b981";
const WARN = "#f59e0b";
const CRITICAL = "#ef4444";
const INK = "#5c6878";

// Synthetic but plausible 12-month collection trend
const COLLECTION_TREND = [
  { month: "May 25", collected: 9.2, levied: 11.4 },
  { month: "Jun 25", collected: 10.1, levied: 11.4 },
  { month: "Jul 25", collected: 14.8, levied: 18.2 },
  { month: "Aug 25", collected: 12.4, levied: 13.1 },
  { month: "Sep 25", collected: 11.0, levied: 11.9 },
  { month: "Oct 25", collected: 13.6, levied: 14.4 },
  { month: "Nov 25", collected: 12.2, levied: 12.7 },
  { month: "Dec 25", collected: 11.5, levied: 12.1 },
  { month: "Jan 26", collected: 10.9, levied: 11.6 },
  { month: "Feb 26", collected: 12.4, levied: 12.9 },
  { month: "Mar 26", collected: 13.8, levied: 14.3 },
  { month: "Apr 26", collected: 14.2, levied: 14.8 },
];

export function CollectionTrendChart() {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={COLLECTION_TREND}>
        <defs>
          <linearGradient id="grad-collected" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.45} />
            <stop offset="100%" stopColor={SUCCESS} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="grad-levied" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#eef0f4" vertical={false} />
        <XAxis dataKey="month" stroke={INK} fontSize={11} tickLine={false} />
        <YAxis
          stroke={INK}
          fontSize={11}
          tickLine={false}
          tickFormatter={(v) => `$${v}M`}
        />
        <Tooltip
          formatter={(v: number) => `$${v.toFixed(1)}M`}
          contentStyle={{
            background: "white",
            border: "1px solid #dde2ea",
            borderRadius: "6px",
            fontSize: "12px",
          }}
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <Area
          type="monotone"
          dataKey="levied"
          stroke={ACCENT}
          fill="url(#grad-levied)"
          name="Levied"
        />
        <Area
          type="monotone"
          dataKey="collected"
          stroke={SUCCESS}
          fill="url(#grad-collected)"
          name="Collected"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SeverityChart({
  high,
  medium,
  low,
}: {
  high: number;
  medium: number;
  low: number;
}) {
  const data = [
    { name: "High", value: high, fill: CRITICAL },
    { name: "Medium", value: medium, fill: WARN },
    { name: "Low", value: low, fill: INK },
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={3}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "white",
            border: "1px solid #dde2ea",
            borderRadius: "6px",
            fontSize: "12px",
          }}
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CouncilBarChart({
  data,
}: {
  data: { council: string; uplift: number; overdue: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
        <CartesianGrid stroke="#eef0f4" vertical={false} />
        <XAxis dataKey="council" stroke={INK} fontSize={11} tickLine={false} />
        <YAxis
          stroke={INK}
          fontSize={11}
          tickLine={false}
          tickFormatter={(v) =>
            v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
          }
        />
        <Tooltip
          formatter={(v: number) => `$${v.toLocaleString()}`}
          contentStyle={{
            background: "white",
            border: "1px solid #dde2ea",
            borderRadius: "6px",
            fontSize: "12px",
          }}
        />
        <Legend wrapperStyle={{ fontSize: "12px" }} />
        <Bar
          dataKey="uplift"
          fill={SUCCESS}
          name="Recovery uplift"
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="overdue"
          fill={WARN}
          name="Overdue $"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
