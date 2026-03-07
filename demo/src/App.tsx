import React, { useEffect, useState } from "react";

interface BenchRow {
  n: number;
  solidityGas: number;
  precompileGas: number | null;
}

const MOCK_DATA: BenchRow[] = [
  { n: 10, solidityGas: 21_450, precompileGas: 8_200 },
  { n: 50, solidityGas: 22_100, precompileGas: 8_350 },
  { n: 100, solidityGas: 22_900, precompileGas: 8_500 },
  { n: 500, solidityGas: 27_400, precompileGas: 8_800 },
  { n: 1000, solidityGas: 33_800, precompileGas: 9_100 },
];

function BenchTable({ rows }: { rows: BenchRow[] }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr style={{ background: "#e8e8f0" }}>
          <th style={th}>n</th>
          <th style={th}>Solidity gas</th>
          <th style={th}>PolkaVM gas</th>
          <th style={th}>Savings</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const savings =
            row.precompileGas != null
              ? (((row.solidityGas - row.precompileGas) / row.solidityGas) *
                  100).toFixed(1) + "%"
              : "—";
          return (
            <tr key={row.n}>
              <td style={td}>{row.n}</td>
              <td style={td}>{row.solidityGas.toLocaleString()}</td>
              <td style={td}>
                {row.precompileGas != null
                  ? row.precompileGas.toLocaleString()
                  : "—"}
              </td>
              <td style={{ ...td, color: "#2a9d3f", fontWeight: "bold" }}>
                {savings}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = {
  padding: "8px 16px",
  textAlign: "left",
  borderBottom: "2px solid #ccc",
};
const td: React.CSSProperties = {
  padding: "8px 16px",
  borderBottom: "1px solid #eee",
};

export default function App() {
  const [rows, setRows] = useState<BenchRow[]>([]);

  useEffect(() => {
    // In a real deployment, fetch benchmark JSON from the hardhat output.
    setRows(MOCK_DATA);
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ color: "#e6007a" }}>Polkadot Rust Bridge — Benchmark</h1>
      <p>
        Gas comparison between a pure-Solidity <code>fibonacci</code>{" "}
        implementation and the equivalent PolkaVM Rust precompile.
      </p>
      <BenchTable rows={rows} />
      <p style={{ fontSize: 12, color: "#888", marginTop: 24 }}>
        PolkaVM figures are estimates until the precompile is deployed on a live
        Polkadot parachain.
      </p>
    </div>
  );
}
