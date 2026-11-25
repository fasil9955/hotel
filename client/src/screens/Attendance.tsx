import { useEffect, useState } from "react";
import { getAttendance, markAttendance, type AttendanceRow } from "../api";

export function Attendance() {
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAttendance()
      .then(setRows)
      .catch((caught: unknown) => setError(text(caught)));
  }, []);

  async function mark(employeeId: number, status: "present" | "absent") {
    setError("");
    try {
      setRows(await markAttendance(employeeId, status));
    } catch (caught) {
      setError(text(caught));
    }
  }

  const present = rows?.filter((row) => row.status === "present").length ?? 0;

  return (
    <>
      {error ? <p className="banner bad">{error}</p> : null}
      <section className="panel">
        <h1>Attendance</h1>
        <p className="hint">
          {rows ? `${present} present of ${rows.length}` : "Loading…"}
        </p>
        {rows && rows.length === 0 ? <p className="lede">Add employees from Admin, then mark them here.</p> : null}
        <ul className="menu-list">
          {rows?.map((row) => (
            <li key={row.employeeId}>
              <strong>{row.name}</strong>
              <span className="marks">
                <button type="button" aria-pressed={row.status === "present"} onClick={() => void mark(row.employeeId, "present")}>
                  Present
                </button>
                <button type="button" aria-pressed={row.status === "absent"} onClick={() => void mark(row.employeeId, "absent")}>
                  Absent
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
