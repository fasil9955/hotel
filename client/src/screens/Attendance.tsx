import { useEffect, useState } from "react";
import { getAttendance, markAttendance, type MonthAttendance } from "../api";

export function Attendance() {
  const [sheet, setSheet] = useState<MonthAttendance | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAttendance()
      .then(setSheet)
      .catch((caught: unknown) => setError(text(caught)));
  }, []);

  async function mark(employeeId: number, status: "present" | "half" | "absent") {
    setError("");
    try {
      setSheet(await markAttendance(employeeId, status));
    } catch (caught) {
      setError(text(caught));
    }
  }

  const todayIndex = sheet ? sheet.days.indexOf(sheet.today) : -1;
  const present = sheet?.rows.filter((row) => row.marks[todayIndex] === "present").length ?? 0;
  const half = sheet?.rows.filter((row) => row.marks[todayIndex] === "half").length ?? 0;

  return (
    <>
      {error ? <p className="banner bad">{error}</p> : null}
      <section className="panel">
        <h1>Attendance</h1>
        <p className="hint">
          {sheet
            ? `${monthLabel(sheet.today)}. Today: ${present} present, ${half} half day, of ${sheet.rows.length}. P is a full day, H is half pay, A is absent. Only today can be marked.`
            : "Loading…"}
        </p>
        {sheet && sheet.rows.length === 0 ? <p className="lede">Add employees from Admin, then mark them here.</p> : null}
        {sheet && sheet.rows.length > 0 ? (
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="name">Name</th>
                  {sheet.days.map((day) => (
                    <th key={day} className={day === sheet.today ? "today" : undefined}>
                      {Number(day.slice(8))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row) => (
                  <tr key={row.employeeId}>
                    <th className="name">{row.name}</th>
                    {sheet.days.map((day, index) => {
                      const markValue = row.marks[index] ?? "";
                      const today = day === sheet.today;
                      return (
                        <td key={day} className={today ? "today" : undefined}>
                          {today ? (
                            <span className="today-marks">
                              <button
                                type="button"
                                aria-label={`Present ${row.name}`}
                                aria-pressed={markValue === "present"}
                                onClick={() => void mark(row.employeeId, "present")}
                              >
                                P
                              </button>
                              <button
                                type="button"
                                aria-label={`Half day ${row.name}`}
                                aria-pressed={markValue === "half"}
                                onClick={() => void mark(row.employeeId, "half")}
                              >
                                H
                              </button>
                              <button
                                type="button"
                                aria-label={`Absent ${row.name}`}
                                aria-pressed={markValue === "absent"}
                                onClick={() => void mark(row.employeeId, "absent")}
                              >
                                A
                              </button>
                            </span>
                          ) : (
                            <span className={markValue ? `cell-mark ${markValue}` : "cell-mark empty"}>
                              {markValue === "present" ? "P" : markValue === "half" ? "H" : markValue === "absent" ? "A" : ""}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

function monthLabel(today: string): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
