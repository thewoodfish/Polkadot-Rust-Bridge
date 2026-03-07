import React, { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TooltipProps } from "recharts";
import data from "./data/benchmark-results.json";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  pink:   "#E6007A",
  teal:   "#2DD4BF",
  orange: "#F97316",
  green:  "#22D3A0",
  bg:     "#0d0d14",
  surface:"#13131e",
  card:   "#1a1a28",
  border: "#252536",
  text:   "#e2e8f0",
  dim:    "#94a3b8",
  muted:  "#4a5568",
} as const;

const mono: React.CSSProperties = {
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, 'Courier New', monospace",
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  id,
  label,
  children,
}: {
  id?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: 72 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 28,
          borderBottom: `1px solid ${C.border}`,
          paddingBottom: 12,
        }}
      >
        <span
          style={{
            ...mono,
            color: C.pink,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      {children}
    </section>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Architecture diagram
// ─────────────────────────────────────────────────────────────────────────────

const ARCH_NODES = [
  {
    label: "Solidity Contract",
    sub: "RustBridge.sol",
    color: C.orange,
    detail: "callPrecompile(data)",
  },
  {
    label: "PVM Precompile",
    sub: "0x900 – 0x902",
    color: C.pink,
    detail: "selector dispatch",
  },
  {
    label: "Rust Library",
    sub: "rust-bridge crate",
    color: C.teal,
    detail: "native RISC-V exec",
  },
  {
    label: "Result",
    sub: "ABI-encoded bytes",
    color: C.green,
    detail: "uint256 / bool / int256",
  },
] as const;

function ArchDiagram() {
  return (
    <Card>
      {/* Flow row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          justifyContent: "center",
        }}
      >
        {ARCH_NODES.map((node, i) => (
          <React.Fragment key={node.label}>
            <div
              style={{
                border: `1px solid ${node.color}`,
                borderRadius: 6,
                padding: "14px 20px",
                textAlign: "center",
                minWidth: 148,
                background: `${node.color}14`,
                flex: "1 1 140px",
                maxWidth: 200,
              }}
            >
              <div
                style={{
                  ...mono,
                  color: node.color,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {node.label}
              </div>
              <div style={{ ...mono, color: C.dim, fontSize: 11, marginTop: 4 }}>
                {node.sub}
              </div>
              <div
                style={{
                  ...mono,
                  color: C.muted,
                  fontSize: 10,
                  marginTop: 6,
                  borderTop: `1px solid ${C.border}`,
                  paddingTop: 6,
                }}
              >
                {node.detail}
              </div>
            </div>
            {i < ARCH_NODES.length - 1 && (
              <div
                style={{
                  color: C.muted,
                  fontSize: 18,
                  flexShrink: 0,
                  padding: "0 2px",
                }}
              >
                →
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ASCII art legend */}
      <pre
        style={{
          ...mono,
          fontSize: 10,
          color: C.muted,
          marginTop: 20,
          borderTop: `1px solid ${C.border}`,
          paddingTop: 16,
          overflowX: "auto",
          lineHeight: 1.5,
        }}
      >
        {[
          "  Solidity ABI call ──→ raw .call(selector ++ args)",
          "  PolkaVM host        ──→ routes to registered precompile blob",
          "  Rust crate          ──→ extern \"C\" fn call(input, output) → i32",
          "  Gas model           ──→ RISC-V instruction metering (not EVM opcodes)",
        ].join("\n")}
      </pre>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Benchmark (chart + table toggle)
// ─────────────────────────────────────────────────────────────────────────────

function shortLabel(op: string): string {
  return op
    .replace("poseidonHash", "poseidon")
    .replace("blsVerify", "bls")
    .replace("dotProduct", "dot")
    .replace("(n=", " n=")
    .replace(") msg)", ")")
    .replace(" msg)", "")
    .replace(", mixed)", "m)");
}

type ChartRow = {
  label: string;
  solidity: number;
  precompile: number;
  speedup: number;
};

const chartData: ChartRow[] = data.results.map((r) => ({
  label: shortLabel(r.operation),
  solidity: r.pureSolidityGas,
  precompile: r.rustPrecompileGas,
  speedup: r.speedup,
}));

function BenchTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = chartData.find((d) => d.label === label);
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "12px 16px",
        ...mono,
        fontSize: 12,
      }}
    >
      <div style={{ color: C.text, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginBottom: 4 }}>
          {p.name}:{" "}
          <span style={{ color: C.text }}>
            {(p.value as number).toLocaleString()} gas
          </span>
        </div>
      ))}
      {row && (
        <div
          style={{
            color: C.pink,
            marginTop: 8,
            borderTop: `1px solid ${C.border}`,
            paddingTop: 8,
          }}
        >
          speedup: <strong>{row.speedup}×</strong>
        </div>
      )}
    </div>
  );
}

function BenchChart() {
  return (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 64, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ ...mono, fill: C.dim, fontSize: 10, angle: -32, textAnchor: "end" } as React.SVGProps<SVGTextElement>}
          tickLine={false}
          axisLine={{ stroke: C.border }}
          interval={0}
          height={70}
        />
        <YAxis
          tickFormatter={(v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
          }
          tick={{ ...mono, fill: C.dim, fontSize: 11 } as React.SVGProps<SVGTextElement>}
          tickLine={false}
          axisLine={false}
          width={38}
        />
        <Tooltip content={<BenchTooltip />} cursor={{ fill: `${C.border}66` }} />
        <Legend
          wrapperStyle={{ ...mono, fontSize: 12, paddingTop: 4 }}
          formatter={(value: string) => (
            <span style={{ color: C.dim }}>{value}</span>
          )}
        />
        <Bar
          dataKey="solidity"
          name="Solidity Gas"
          fill={C.orange}
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="precompile"
          name="Rust Precompile Gas"
          fill={C.teal}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BenchTable() {
  const maxSpeedup = Math.max(...data.results.map((r) => r.speedup));
  const th: React.CSSProperties = {
    padding: "8px 14px",
    color: C.dim,
    fontWeight: 600,
    letterSpacing: "0.07em",
    fontSize: 10,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${C.border}`,
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", ...mono, fontSize: 12 }}
      >
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Operation</th>
            <th style={{ ...th, textAlign: "right", color: C.orange }}>
              Solidity Gas
            </th>
            <th style={{ ...th, textAlign: "right", color: C.teal }}>
              Rust Precompile Gas
            </th>
            <th style={{ ...th, textAlign: "right", color: C.pink }}>
              Speedup
            </th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((r, i) => (
            <tr
              key={r.operation}
              style={{
                borderBottom: `1px solid ${C.border}`,
                background: i % 2 === 0 ? "transparent" : `${C.muted}0a`,
              }}
            >
              <td style={{ padding: "9px 14px", color: C.text }}>{r.operation}</td>
              <td
                style={{ padding: "9px 14px", textAlign: "right", color: C.orange }}
              >
                {r.pureSolidityGas.toLocaleString()}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", color: C.teal }}>
                {r.rustPrecompileGas.toLocaleString()}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>
                <span
                  style={{
                    background: `${C.pink}22`,
                    color: C.pink,
                    padding: "2px 10px",
                    borderRadius: 4,
                    fontWeight: 600,
                    display: "inline-block",
                    minWidth: 52,
                    textAlign: "center",
                    opacity: 0.55 + 0.45 * (r.speedup / maxSpeedup),
                  }}
                >
                  {r.speedup}×
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        style={{
          ...mono,
          fontSize: 10,
          color: C.muted,
          marginTop: 10,
          lineHeight: 1.6,
        }}
      >
        * Hardhat EVM mock — speedup = solidityGas ÷ precompileInnerGas (from{" "}
        <span style={{ color: C.dim }}>PrecompileCalled</span> event, excludes 21k
        base tx cost). Real PolkaVM performance will be significantly higher.
      </p>
    </div>
  );
}

function BenchSection() {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <>
      {/* Toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["chart", "table"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              ...mono,
              fontSize: 11,
              padding: "5px 16px",
              border: `1px solid ${view === v ? C.pink : C.border}`,
              borderRadius: 4,
              background: view === v ? `${C.pink}22` : "transparent",
              color: view === v ? C.pink : C.dim,
              cursor: "pointer",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {v}
          </button>
        ))}
      </div>
      <Card style={{ padding: view === "chart" ? 16 : 0, overflow: "hidden" }}>
        {view === "chart" ? <BenchChart /> : <BenchTable />}
      </Card>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Code example
// ─────────────────────────────────────────────────────────────────────────────

// Manual Solidity syntax highlighting — returns a ReactNode per logical line
type Span = { text: string; color: string };
const s = (text: string, color: string): Span => ({ text, color });

const KW = "#60a5fa";  // type keywords   (uint256, memory, bool, bytes)
const FN = C.teal;     // function/method  (poseidonHash, blsVerify, dotProduct)
const OP = C.dim;      // operators & punctuation
const NU = "#a78bfa";  // numbers / literals
const CM = C.muted;    // comments

const CODE: Span[][] = [
  [s("// Solidity: call the Rust precompile via RustBridge", CM)],
  [],
  [
    s("uint256", KW), s("[] ", OP), s("memory", KW), s(" inputs = ", OP),
    s("new", KW), s(" ", OP), s("uint256", KW), s("[](", OP), s("3", NU), s(");", OP),
  ],
  [
    s("inputs[", OP), s("0", NU), s("] = ", OP), s("1", NU), s("; ", OP),
    s("inputs[", OP), s("1", NU), s("] = ", OP), s("2", NU), s("; ", OP),
    s("inputs[", OP), s("2", NU), s("] = ", OP), s("3", NU), s(";", OP),
  ],
  [],
  [
    s("uint256", KW), s(" hash = ", OP), s("RustBridge", C.text),
    s(".", OP), s("poseidonHash", FN), s("(inputs);", OP),
  ],
  [s("// ~4,700 gas vs ~23,000 gas for a direct Solidity call", CM)],
  [],
  [s("// BLS12-381 signature verification", CM)],
  [
    s("bool", KW), s(" valid = ", OP), s("RustBridge", C.text),
    s(".", OP), s("blsVerify", FN), s("(pubkey, message, sig);", OP),
  ],
  [s("// stub always returns true — real BLS on PolkaVM", CM)],
  [],
  [s("// Signed dot product with overflow protection", CM)],
  [
    s("int256", KW), s(" result = ", OP), s("RustBridge", C.text),
    s(".", OP), s("dotProduct", FN), s("(vecA, vecB);", OP),
  ],
  [s("// reverts on int256 overflow, matches Rust checked_mul/add", CM)],
];

function CodeExample() {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        {["#ff5f56", "#ffbd2e", "#27c93f"].map((col) => (
          <div
            key={col}
            style={{ width: 10, height: 10, borderRadius: "50%", background: col }}
          />
        ))}
        <span style={{ ...mono, fontSize: 11, color: C.dim, marginLeft: 8 }}>
          RustBridge.sol
        </span>
      </div>

      {/* Code */}
      <pre
        style={{
          ...mono,
          fontSize: 13,
          lineHeight: 1.7,
          padding: "24px 28px",
          overflowX: "auto",
          margin: 0,
        }}
      >
        {CODE.map((line, li) =>
          line.length === 0 ? (
            <br key={li} />
          ) : (
            <div key={li}>
              {line.map((tok, ti) => (
                <span key={ti} style={{ color: tok.color }}>
                  {tok.text}
                </span>
              ))}
            </div>
          )
        )}
      </pre>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Why this matters
// ─────────────────────────────────────────────────────────────────────────────

const WHY_CARDS = [
  {
    icon: "◈",
    title: "ZK Apps",
    color: C.pink,
    body: "Poseidon hash and ZK circuit witness generation in native Rust — no EVM opcode bottleneck. Enables affordable on-chain SNARK verification at scale.",
    tag: "Poseidon · Groth16 · PLONK",
  },
  {
    icon: "◎",
    title: "AI Inference",
    color: C.teal,
    body: "Run ONNX or llama.cpp models as a registered precompile. Native RISC-V speed means inference that would cost millions of gas becomes practical.",
    tag: "ONNX · Tensors · LLM",
  },
  {
    icon: "◇",
    title: "Cryptography",
    color: C.orange,
    body: "BLS12-381 aggregation, secp256r1 signatures, and Pedersen commitments at native speed — 10–100× cheaper than equivalent EVM bytecode.",
    tag: "BLS · ECDSA · Pedersen",
  },
] as const;

function WhyCards() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 20,
      }}
    >
      {WHY_CARDS.map((card) => (
        <Card key={card.title} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22, color: card.color }}>{card.icon}</span>
            <span
              style={{
                ...mono,
                fontSize: 15,
                fontWeight: 600,
                color: card.color,
              }}
            >
              {card.title}
            </span>
          </div>
          <p style={{ ...mono, fontSize: 12, color: C.dim, lineHeight: 1.7, flexGrow: 1 }}>
            {card.body}
          </p>
          <div
            style={{
              ...mono,
              fontSize: 10,
              color: C.muted,
              background: `${card.color}11`,
              border: `1px solid ${card.color}33`,
              borderRadius: 4,
              padding: "4px 10px",
              letterSpacing: "0.06em",
              alignSelf: "flex-start",
            }}
          >
            {card.tag}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.text,
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        style={{
          borderBottom: `1px solid ${C.border}`,
          background: C.surface,
          padding: "32px 0 28px",
          marginBottom: 56,
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px" }}>
          {/* Network badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: C.teal,
                boxShadow: `0 0 6px ${C.teal}`,
              }}
            />
            <span style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.1em" }}>
              HARDHAT LOCAL  ·  {data.runs} RUNS AVERAGED  ·  {data.timestamp.split("T")[0]}
            </span>
          </div>

          <h1
            style={{
              ...mono,
              fontSize: 28,
              fontWeight: 600,
              color: C.text,
              marginBottom: 10,
              lineHeight: 1.3,
            }}
          >
            <span style={{ color: C.pink }}>Rust Bridge</span>
            {" — "}
            Polkadot PVM Precompiles
          </h1>
          <p style={{ ...mono, fontSize: 13, color: C.dim, maxWidth: 560, lineHeight: 1.6 }}>
            Calling native Rust libraries from Solidity via PolkaVM's precompile
            interface — benchmarked against equivalent EVM execution.
          </p>

          {/* Pill badges */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
            {[
              { label: "Solidity 0.8.24", color: C.orange },
              { label: "PolkaVM / pallet-revive", color: C.pink },
              { label: "Rust 2021 edition", color: C.teal },
              { label: "Hardhat + ethers v6", color: C.dim },
            ].map(({ label, color }) => (
              <span
                key={label}
                style={{
                  ...mono,
                  fontSize: 10,
                  padding: "3px 10px",
                  border: `1px solid ${color}44`,
                  borderRadius: 20,
                  color,
                  background: `${color}11`,
                  letterSpacing: "0.04em",
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px 80px" }}>
        <Section id="arch" label="01 · Architecture">
          <ArchDiagram />
        </Section>

        <Section id="bench" label="02 · Benchmark Results">
          <BenchSection />
        </Section>

        <Section id="code" label="03 · Code Example">
          <CodeExample />
        </Section>

        <Section id="why" label="04 · Why This Matters">
          <WhyCards />
        </Section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: `1px solid ${C.border}`,
          padding: "20px 32px",
          ...mono,
          fontSize: 11,
          color: C.muted,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <span>
          polkadot-rust-bridge ·{" "}
          <span style={{ color: C.pink }}>MIT</span>
        </span>
        <span>generated {data.timestamp}</span>
      </footer>
    </div>
  );
}
