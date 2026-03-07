import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { TooltipProps } from "recharts";
import localData    from "./data/benchmark-results-local.json";
import testnetData  from "./data/benchmark-results-testnet.json";
import deployments  from "./data/deployments.json";

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  pink:    "#E6007A",
  teal:    "#2DD4BF",
  orange:  "#F97316",
  green:   "#22D3A0",
  bg:      "#0d0d14",
  surface: "#13131e",
  card:    "#1a1a28",
  border:  "#252536",
  text:    "#e2e8f0",
  dim:     "#94a3b8",
  muted:   "#4a5568",
} as const;

const mono: React.CSSProperties = {
  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, 'Courier New', monospace",
};

// ─────────────────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────────────────

type DataSource = "local" | "testnet";

interface BenchResult {
  operation:         string;
  rustPrecompileGas: number;
  pureSolidityGas:   number;
  speedup:           number;
  note:              string;
}

interface BenchData {
  timestamp: string | null;
  network:   string;
  runs:      number;
  results:   BenchResult[];
}

const DATA: Record<DataSource, BenchData> = {
  local:   localData   as BenchData,
  testnet: testnetData as BenchData,
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

function Section({ id, label, children }: {
  id?: string; label: string; children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: 72 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 28, borderBottom: `1px solid ${C.border}`, paddingBottom: 12,
      }}>
        <span style={{
          ...mono, color: C.pink, fontSize: 11, fontWeight: 600,
          letterSpacing: "0.14em", textTransform: "uppercase",
        }}>{label}</span>
      </div>
      {children}
    </section>
  );
}

function Card({ children, style }: {
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 24, ...style,
    }}>{children}</div>
  );
}

function Badge({ label, color, dot }: {
  label: string; color: string; dot?: boolean;
}) {
  return (
    <span style={{
      ...mono, fontSize: 10, padding: "3px 10px",
      border: `1px solid ${color}44`, borderRadius: 20,
      color, background: `${color}11`, letterSpacing: "0.04em",
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
      {dot && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: color, boxShadow: `0 0 5px ${color}`,
          display: "inline-block",
        }} />
      )}
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Architecture diagram
// ─────────────────────────────────────────────────────────────────────────────

const ARCH_NODES = [
  { label: "Solidity Contract", sub: "RustBridge.sol",     color: C.orange, detail: "callPrecompile(data)" },
  { label: "PVM Precompile",    sub: "0x900 – 0x902",      color: C.pink,   detail: "selector dispatch" },
  { label: "Rust Library",      sub: "rust-bridge crate",  color: C.teal,   detail: "native RISC-V exec" },
  { label: "Result",            sub: "ABI-encoded bytes",  color: C.green,  detail: "uint256 / bool / int256" },
] as const;

function ArchDiagram() {
  return (
    <Card>
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: 6, justifyContent: "center",
      }}>
        {ARCH_NODES.map((node, i) => (
          <React.Fragment key={node.label}>
            <div style={{
              border: `1px solid ${node.color}`, borderRadius: 6,
              padding: "14px 20px", textAlign: "center", minWidth: 148,
              background: `${node.color}14`, flex: "1 1 140px", maxWidth: 200,
            }}>
              <div style={{ ...mono, color: node.color, fontSize: 12, fontWeight: 600 }}>
                {node.label}
              </div>
              <div style={{ ...mono, color: C.dim, fontSize: 11, marginTop: 4 }}>
                {node.sub}
              </div>
              <div style={{
                ...mono, color: C.muted, fontSize: 10, marginTop: 6,
                borderTop: `1px solid ${C.border}`, paddingTop: 6,
              }}>{node.detail}</div>
            </div>
            {i < ARCH_NODES.length - 1 && (
              <div style={{ color: C.muted, fontSize: 18, flexShrink: 0, padding: "0 2px" }}>→</div>
            )}
          </React.Fragment>
        ))}
      </div>
      <pre style={{
        ...mono, fontSize: 10, color: C.muted, marginTop: 20,
        borderTop: `1px solid ${C.border}`, paddingTop: 16,
        overflowX: "auto", lineHeight: 1.5,
      }}>{[
        "  Solidity ABI call ──→ raw .call(selector ++ args)",
        "  PolkaVM host        ──→ routes to registered precompile blob",
        "  Rust crate          ──→ extern \"C\" fn call(input, output) → i32",
        "  Gas model           ──→ RISC-V instruction metering (not EVM opcodes)",
      ].join("\n")}</pre>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Benchmark (data-source-aware)
// ─────────────────────────────────────────────────────────────────────────────

function shortLabel(op: string): string {
  return op
    .replace("poseidonHash", "poseidon").replace("blsVerify", "bls")
    .replace("dotProduct", "dot").replace("(n=", " n=")
    .replace(") msg)", ")").replace(" msg)", "").replace(", mixed)", "m)");
}

type ChartRow = { label: string; solidity: number; precompile: number; speedup: number };

function toChartRows(results: BenchResult[]): ChartRow[] {
  return results.map((r) => ({
    label:      shortLabel(r.operation),
    solidity:   r.pureSolidityGas,
    precompile: r.rustPrecompileGas,
    speedup:    r.speedup,
  }));
}

// BenchTooltip is created as a closure inside BenchChart so it can reference
// `rows` without needing an extra prop that would conflict with recharts' types.
function makeBenchTooltip(rows: ChartRow[]) {
  return function BenchTooltipContent({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const row = rows.find((d) => d.label === label);
    return (
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 6, padding: "12px 16px", ...mono, fontSize: 12,
      }}>
        <div style={{ color: C.text, fontWeight: 600, marginBottom: 8 }}>{label}</div>
        {payload.map((p) => (
          <div key={p.dataKey} style={{ color: p.color, marginBottom: 4 }}>
            {p.name}:{" "}
            <span style={{ color: C.text }}>{(p.value as number).toLocaleString()} gas</span>
          </div>
        ))}
        {row && (
          <div style={{
            color: C.pink, marginTop: 8,
            borderTop: `1px solid ${C.border}`, paddingTop: 8,
          }}>
            speedup: <strong>{row.speedup}×</strong>
          </div>
        )}
      </div>
    );
  };
}

function BenchChart({ results }: { results: BenchResult[] }) {
  const rows = toChartRows(results);
  const TooltipContent = makeBenchTooltip(rows);
  return (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 64, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ ...mono, fill: C.dim, fontSize: 10, angle: -32, textAnchor: "end" } as React.SVGProps<SVGTextElement>}
          tickLine={false} axisLine={{ stroke: C.border }} interval={0} height={70}
        />
        <YAxis
          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
          tick={{ ...mono, fill: C.dim, fontSize: 11 } as React.SVGProps<SVGTextElement>}
          tickLine={false} axisLine={false} width={38}
        />
        <Tooltip content={<TooltipContent />} cursor={{ fill: `${C.border}66` }} />
        <Legend
          wrapperStyle={{ ...mono, fontSize: 12, paddingTop: 4 }}
          formatter={(value: string) => <span style={{ color: C.dim }}>{value}</span>}
        />
        <Bar dataKey="solidity"   name="Solidity Gas"       fill={C.orange} radius={[3, 3, 0, 0]} />
        <Bar dataKey="precompile" name="Rust Precompile Gas" fill={C.teal}  radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BenchTable({ results, source }: { results: BenchResult[]; source: DataSource }) {
  const maxSpeedup = Math.max(...results.map((r) => r.speedup));
  const th: React.CSSProperties = {
    padding: "8px 14px", color: C.dim, fontWeight: 600,
    letterSpacing: "0.07em", fontSize: 10, textTransform: "uppercase",
    whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`,
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", ...mono, fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Operation</th>
            <th style={{ ...th, textAlign: "right", color: C.orange }}>Solidity Gas</th>
            <th style={{ ...th, textAlign: "right", color: C.teal }}>Rust Gas</th>
            <th style={{ ...th, textAlign: "right", color: C.pink }}>Speedup</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={r.operation} style={{
              borderBottom: `1px solid ${C.border}`,
              background: i % 2 === 0 ? "transparent" : `${C.muted}0a`,
            }}>
              <td style={{ padding: "9px 14px", color: C.text }}>{r.operation}</td>
              <td style={{ padding: "9px 14px", textAlign: "right", color: C.orange }}>
                {r.pureSolidityGas.toLocaleString()}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", color: C.teal }}>
                {r.rustPrecompileGas.toLocaleString()}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right" }}>
                <span style={{
                  background: `${C.pink}22`, color: C.pink, padding: "2px 10px",
                  borderRadius: 4, fontWeight: 600, display: "inline-block",
                  minWidth: 52, textAlign: "center",
                  opacity: 0.55 + 0.45 * (r.speedup / maxSpeedup),
                }}>{r.speedup}×</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {source === "local" && (
        <p style={{ ...mono, fontSize: 10, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
          * Hardhat EVM mock — speedup = solidityGas ÷ precompileInnerGas (from{" "}
          <span style={{ color: C.dim }}>PrecompileCalled</span> event, excludes 21k base
          tx cost). Real PolkaVM performance will be significantly higher.
        </p>
      )}
    </div>
  );
}

function BenchSection({ source }: { source: DataSource }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const activeData = DATA[source];
  const hasResults = activeData.results.length > 0;

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["chart", "table"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            ...mono, fontSize: 11, padding: "5px 16px",
            border: `1px solid ${view === v ? C.pink : C.border}`,
            borderRadius: 4,
            background: view === v ? `${C.pink}22` : "transparent",
            color: view === v ? C.pink : C.dim,
            cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>{v}</button>
        ))}
      </div>

      {hasResults ? (
        <Card style={{ padding: view === "chart" ? 16 : 0, overflow: "hidden" }}>
          {view === "chart"
            ? <BenchChart results={activeData.results} />
            : <BenchTable results={activeData.results} source={source} />}
        </Card>
      ) : (
        <Card style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 16, padding: 56, textAlign: "center",
        }}>
          <div style={{ fontSize: 32, color: C.muted }}>◎</div>
          <div style={{ ...mono, fontSize: 14, color: C.dim, fontWeight: 600 }}>
            No testnet data yet
          </div>
          <div style={{ ...mono, fontSize: 12, color: C.muted, maxWidth: 400, lineHeight: 1.7 }}>
            Deploy to Polkadot Hub Testnet to capture real on-chain gas figures.
          </div>
          <pre style={{
            ...mono, fontSize: 11, color: C.dim,
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "12px 20px", marginTop: 8,
          }}>{`npm run deploy`}</pre>
          <div style={{ ...mono, fontSize: 10, color: C.muted }}>
            Results will appear here after{" "}
            <span style={{ color: C.pink }}>benchmark-results-testnet.json</span> is populated.
          </div>
        </Card>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Code example
// ─────────────────────────────────────────────────────────────────────────────

type Span = { text: string; color: string };
const s = (text: string, color: string): Span => ({ text, color });

const KW = "#60a5fa";
const FN = C.teal;
const OP = C.dim;
const NU = "#a78bfa";
const CM = C.muted;
const ST = "#86efac"; // string literals

const CODE_SOLIDITY: Span[][] = [
  [s("// Solidity: call the Rust precompile via RustBridge", CM)],
  [],
  [s("uint256", KW), s("[] ", OP), s("memory", KW), s(" inputs = ", OP),
   s("new", KW), s(" ", OP), s("uint256", KW), s("[](", OP), s("3", NU), s(");", OP)],
  [s("inputs[", OP), s("0", NU), s("] = ", OP), s("1", NU), s(";  inputs[", OP),
   s("1", NU), s("] = ", OP), s("2", NU), s(";  inputs[", OP), s("2", NU), s("] = ", OP), s("3", NU), s(";", OP)],
  [],
  [s("uint256", KW), s(" hash = ", OP), s("RustBridge", C.text),
   s(".", OP), s("poseidonHash", FN), s("(inputs);", OP)],
  [s("// ~4,700 gas vs ~23,000 gas for a direct Solidity call", CM)],
  [],
  [s("int256", KW), s(" result = ", OP), s("RustBridge", C.text),
   s(".", OP), s("dotProduct", FN), s("(vecA, vecB);", OP)],
  [s("// checked_mul + checked_add — reverts on overflow", CM)],
];

const xcmAddr = deployments.testnet.xcmRustBridge || "0x<XCMRustBridge address>";

const CODE_ETHERS: Span[][] = [
  [s("// ethers.js v6: call XCMRustBridge on Polkadot Hub Testnet", CM)],
  [],
  [s("import", KW), s(" { ethers } ", OP), s("from", KW), s(" ", OP), s('"ethers"', ST), s(";", OP)],
  [],
  [s("const", KW), s(" provider = ", OP), s("new", KW), s(" ethers.", OP),
   s("JsonRpcProvider", FN), s("(", OP),
   s('"wss://westend-asset-hub-rpc.polkadot.io"', ST), s(");", OP)],
  [],
  [s("const", KW), s(" abi = [", OP)],
  [s('  "function directDotProduct(int128[], int128[]) returns (int128)"', ST), s(",", OP)],
  [s('  "function directPoseidonHash(uint128[]) returns (uint128)"', ST), s(",", OP)],
  [s('  "function directBlsVerify(bytes, bytes, bytes) returns (bool)"', ST)],
  [s("];", OP)],
  [],
  [s("const", KW), s(" contract = ", OP), s("new", KW), s(" ethers.", OP),
   s("Contract", FN), s("(", OP)],
  [s(`  "${xcmAddr}"`, ST), s(",", OP)],
  [s("  abi, signer", OP)],
  [s(");", OP)],
  [],
  [s("const", KW), s(" result = ", OP), s("await", KW),
   s(" contract.", OP), s("directDotProduct", FN),
   s("([", OP), s("1n", NU), s(", ", OP), s("2n", NU), s(", ", OP), s("3n", NU), s("], [", OP),
   s("4n", NU), s(", ", OP), s("5n", NU), s(", ", OP), s("6n", NU), s("]);", OP)],
  [s("// result === 32n", CM)],
];

function CodeBlock({ title, lines }: { title: string; lines: Span[][] }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px", background: C.surface,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {["#ff5f56", "#ffbd2e", "#27c93f"].map((col) => (
          <div key={col} style={{ width: 10, height: 10, borderRadius: "50%", background: col }} />
        ))}
        <span style={{ ...mono, fontSize: 11, color: C.dim, marginLeft: 8 }}>{title}</span>
      </div>
      <pre style={{ ...mono, fontSize: 13, lineHeight: 1.7, padding: "24px 28px", overflowX: "auto", margin: 0 }}>
        {lines.map((line, li) =>
          line.length === 0 ? <br key={li} /> : (
            <div key={li}>
              {line.map((tok, ti) => (
                <span key={ti} style={{ color: tok.color }}>{tok.text}</span>
              ))}
            </div>
          )
        )}
      </pre>
    </Card>
  );
}

function CodeExample() {
  const [tab, setTab] = useState<"solidity" | "ethers">("solidity");
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {([["solidity", "RustBridge.sol"], ["ethers", "ethers.js v6"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            ...mono, fontSize: 11, padding: "5px 16px",
            border: `1px solid ${tab === v ? C.teal : C.border}`,
            borderRadius: 4,
            background: tab === v ? `${C.teal}22` : "transparent",
            color: tab === v ? C.teal : C.dim,
            cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>{label}</button>
        ))}
      </div>
      {tab === "solidity"
        ? <CodeBlock title="RustBridge.sol"   lines={CODE_SOLIDITY} />
        : <CodeBlock title="ethers.js — XCMRustBridge" lines={CODE_ETHERS} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — How to verify
// ─────────────────────────────────────────────────────────────────────────────

function AddrRow({ label, value, explorer }: {
  label: string; value: string; explorer?: string;
}) {
  const deployed = value && value.length > 4;
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap",
      padding: "10px 0", borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ ...mono, fontSize: 11, color: C.dim, minWidth: 160 }}>{label}</span>
      {deployed ? (
        <span style={{ ...mono, fontSize: 12, color: C.teal, wordBreak: "break-all" }}>
          {value}
          {explorer && (
            <a href={`${explorer}/account/${value}`} target="_blank" rel="noreferrer"
              style={{ ...mono, fontSize: 10, color: C.pink, marginLeft: 10 }}>
              [subscan ↗]
            </a>
          )}
        </span>
      ) : (
        <span style={{ ...mono, fontSize: 11, color: C.muted, fontStyle: "italic" }}>
          not yet deployed — run{" "}
          <span style={{ color: C.orange }}>npm run deploy</span>
        </span>
      )}
    </div>
  );
}

const VERIFY_STEPS = [
  { n: "1", text: "Copy .env.example → .env and fill in your RPC URL and private key" },
  { n: "2", text: "Build the ink! contract:  cd precompiles/rust_bridge_ink && cargo contract build --release" },
  { n: "3", text: "Deploy the ink! contract:  ./scripts/deploy-ink.sh" },
  { n: "4", text: "Convert SS58 address → AccountId32 hex, set INK_CONTRACT_ADDRESS in .env" },
  { n: "5", text: "Deploy XCMRustBridge + run smoke test + benchmark:  npm run deploy" },
] as const;

function VerifySection() {
  const d = deployments.testnet;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Deployed addresses */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.dim, marginBottom: 16,
          letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Deployed contracts · {d.network}
        </div>
        <AddrRow label="XCMRustBridge.sol" value={d.xcmRustBridge} explorer={d.explorer} />
        <AddrRow label="rust_bridge_ink"   value={d.inkContract}   explorer={d.explorer} />
        <div style={{ ...mono, fontSize: 10, color: C.muted, marginTop: 12 }}>
          Chain ID: <span style={{ color: C.dim }}>{d.chainId}</span>
          {"  ·  "}
          Explorer:{" "}
          <a href={d.explorer} target="_blank" rel="noreferrer"
            style={{ color: C.teal }}>{d.explorer} ↗</a>
        </div>
      </Card>

      {/* Step-by-step */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.dim, marginBottom: 16,
          letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Deploy it yourself
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {VERIFY_STEPS.map((step) => (
            <div key={step.n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{
                ...mono, fontSize: 10, color: C.pink, fontWeight: 700,
                minWidth: 20, paddingTop: 1,
              }}>{step.n}.</span>
              <span style={{ ...mono, fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
        <pre style={{
          ...mono, fontSize: 12, color: C.teal,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 6, padding: "14px 18px",
          marginTop: 20, overflowX: "auto",
        }}>{`cp .env.example .env
# fill in POLKADOT_HUB_RPC_URL + DEPLOYER_PRIVATE_KEY + SUBSTRATE_SEED
./scripts/deploy-ink.sh
# copy AccountId32 hex into .env as INK_CONTRACT_ADDRESS
npm run deploy`}</pre>
      </Card>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Why this matters
// ─────────────────────────────────────────────────────────────────────────────

const WHY_CARDS = [
  {
    icon: "◈", title: "ZK Apps", color: C.pink,
    body: "Poseidon hash and ZK circuit witness generation in native Rust — no EVM opcode bottleneck. Enables affordable on-chain SNARK verification at scale.",
    tag: "Poseidon · Groth16 · PLONK",
  },
  {
    icon: "◎", title: "AI Inference", color: C.teal,
    body: "Run ONNX or llama.cpp models as a registered precompile. Native RISC-V speed means inference that would cost millions of gas becomes practical.",
    tag: "ONNX · Tensors · LLM",
  },
  {
    icon: "◇", title: "Cryptography", color: C.orange,
    body: "BLS12-381 aggregation, secp256r1 signatures, and Pedersen commitments at native speed — 10–100× cheaper than equivalent EVM bytecode.",
    tag: "BLS · ECDSA · Pedersen",
  },
] as const;

function WhyCards() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
      {WHY_CARDS.map((card) => (
        <Card key={card.title} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22, color: card.color }}>{card.icon}</span>
            <span style={{ ...mono, fontSize: 15, fontWeight: 600, color: card.color }}>
              {card.title}
            </span>
          </div>
          <p style={{ ...mono, fontSize: 12, color: C.dim, lineHeight: 1.7, flexGrow: 1 }}>
            {card.body}
          </p>
          <div style={{
            ...mono, fontSize: 10, color: C.muted,
            background: `${card.color}11`, border: `1px solid ${card.color}33`,
            borderRadius: 4, padding: "4px 10px", letterSpacing: "0.06em",
            alignSelf: "flex-start",
          }}>{card.tag}</div>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [source, setSource] = useState<DataSource>("local");
  const active = DATA[source];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>

      {/* ── Header ── */}
      <header style={{
        borderBottom: `1px solid ${C.border}`, background: C.surface,
        padding: "32px 0 28px", marginBottom: 56,
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px" }}>

          {/* Network status row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", background: C.teal,
              boxShadow: `0 0 6px ${C.teal}`,
            }} />
            <span style={{ ...mono, fontSize: 10, color: C.dim, letterSpacing: "0.1em" }}>
              {source === "local"
                ? `HARDHAT LOCAL  ·  ${active.runs} RUNS AVERAGED  ·  ${active.timestamp?.split("T")[0] ?? "—"}`
                : `POLKADOT HUB TESTNET  ·  ${active.runs} RUNS  ·  ${active.timestamp?.split("T")[0] ?? "not deployed yet"}`}
            </span>

            {/* Data-source toggle */}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {(["local", "testnet"] as const).map((s) => (
                <button key={s} onClick={() => setSource(s)} style={{
                  ...mono, fontSize: 10, padding: "4px 12px",
                  border: `1px solid ${source === s
                    ? (s === "testnet" ? C.green : C.orange)
                    : C.border}`,
                  borderRadius: 20,
                  background: source === s
                    ? `${s === "testnet" ? C.green : C.orange}18`
                    : "transparent",
                  color: source === s
                    ? (s === "testnet" ? C.green : C.orange)
                    : C.muted,
                  cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  {s === "testnet" && (
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: DATA.testnet.results.length > 0 ? C.green : C.muted,
                      boxShadow: DATA.testnet.results.length > 0 ? `0 0 4px ${C.green}` : "none",
                      display: "inline-block",
                    }} />
                  )}
                  {s === "local" ? "Local Mock" : "Polkadot Hub Testnet"}
                </button>
              ))}
            </div>
          </div>

          {/* Disclaimer / Live badge */}
          {source === "local" && (
            <div style={{
              ...mono, fontSize: 10, color: C.orange,
              background: `${C.orange}14`, border: `1px solid ${C.orange}33`,
              borderRadius: 4, padding: "5px 12px", marginBottom: 16,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <span>⚠</span>
              <span>
                Showing estimated speedups from Hardhat mock data.
                Real PolkaVM numbers will be significantly higher.
              </span>
            </div>
          )}
          {source === "testnet" && DATA.testnet.results.length > 0 && (
            <div style={{
              ...mono, fontSize: 10, color: C.green,
              background: `${C.green}14`, border: `1px solid ${C.green}33`,
              borderRadius: 4, padding: "5px 12px", marginBottom: 16,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%",
                background: C.green, boxShadow: `0 0 5px ${C.green}`,
                display: "inline-block" }} />
              <span>Live data — on-chain gas from Polkadot Hub Testnet</span>
            </div>
          )}

          <h1 style={{
            ...mono, fontSize: 28, fontWeight: 600, color: C.text,
            marginBottom: 10, lineHeight: 1.3,
          }}>
            <span style={{ color: C.pink }}>Rust Bridge</span>
            {" — "}Polkadot PVM Precompiles
          </h1>
          <p style={{ ...mono, fontSize: 13, color: C.dim, maxWidth: 560, lineHeight: 1.6 }}>
            Calling native Rust libraries from Solidity via PolkaVM's precompile
            interface — benchmarked against equivalent EVM execution.
          </p>

          {/* Pill badges */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 }}>
            {[
              { label: "Solidity 0.8.24",          color: C.orange },
              { label: "PolkaVM / pallet-revive",   color: C.pink   },
              { label: "Rust 2021 edition",         color: C.teal   },
              { label: "Hardhat + ethers v6",       color: C.dim    },
              { label: "ink! v5",                   color: C.green  },
            ].map(({ label, color }) => (
              <Badge key={label} label={label} color={color} />
            ))}
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px 80px" }}>
        <Section id="arch"   label="01 · Architecture">
          <ArchDiagram />
        </Section>

        <Section id="bench"  label="02 · Benchmark Results">
          <BenchSection source={source} />
        </Section>

        <Section id="code"   label="03 · Code Examples">
          <CodeExample />
        </Section>

        <Section id="verify" label="04 · How to Verify This Yourself">
          <VerifySection />
        </Section>

        <Section id="why"    label="05 · Why This Matters">
          <WhyCards />
        </Section>
      </main>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: `1px solid ${C.border}`, padding: "20px 32px",
        ...mono, fontSize: 11, color: C.muted,
        display: "flex", justifyContent: "space-between",
        flexWrap: "wrap", gap: 8, maxWidth: 1100, margin: "0 auto",
      }}>
        <span>polkadot-rust-bridge · <span style={{ color: C.pink }}>MIT</span></span>
        <span>{active.timestamp ?? "testnet not yet deployed"}</span>
      </footer>
    </div>
  );
}
