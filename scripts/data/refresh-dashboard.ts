import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = Record<string, string>;
type Point = { date: string; label: string; value: number };

const sourceUrls = {
  fao: "https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv?download=true",
  dairy: "https://www.ers.usda.gov/media/5501/us-dairy-situation-at-a-glance-monthly-and-annual.csv?v=54172",
  quarterly: "https://www.ers.usda.gov/media/5503/us-milk-production-and-related-data-quarterly-and-annual.csv?v=49334",
  beef: "https://www.ers.usda.gov/media/5020/choice-beef-values-and-spreads-and-the-all-fresh-retail-value.csv?v=89708"
} as const;

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function load(name: keyof typeof sourceUrls) {
  const localPath = argument(`${name}-file`);
  if (localPath) return readFileSync(localPath, "utf8");
  const response = await fetch(sourceUrls[name]);
  if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
  return response.text();
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function records(rows: string[][], headerName: string) {
  const headerIndex = rows.findIndex((row) => row[0] === headerName);
  if (headerIndex === -1) throw new Error(`CSV header "${headerName}" was not found.`);
  const headers = rows[headerIndex];
  return rows.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))) as Row[];
}

function monthDate(year: string, period: string | number) {
  return `${year}-${String(period).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}-01T00:00:00Z`));
}

function point(date: string, value: number): Point {
  return { date, label: monthLabel(date), value };
}

function quarterPoint(year: string, timeperiodId: string, value: number): Point {
  const quarter = Number(timeperiodId) - 12;
  const endMonth = quarter * 3;
  return { date: monthDate(year, endMonth), label: `Q${quarter} ${year}`, value };
}

function last<T>(values: T[], count: number) {
  return values.slice(Math.max(values.length - count, 0));
}

function faoSeries(rows: Row[], column: "Dairy" | "Meat") {
  return last(rows
    .filter((row) => /^\d{4}-\d{2}$/.test(row.Date) && row[column])
    .map((row) => point(row.Date, Number(row[column])))
    .filter((candidate) => Number.isFinite(candidate.value)), 120);
}

function dairySeries(rows: Row[], category: string, dataItem: string) {
  return last(rows
    .filter((row) => row.Frequency === "Monthly" && row.Category === category && row.Data_item === dataItem && row.Value !== "NA")
    .map((row) => point(monthDate(row.Year, row.Timeperiod_id), Number(row.Value.replaceAll(",", ""))))
    .filter((candidate) => Number.isFinite(candidate.value))
    .sort((a, b) => a.date.localeCompare(b.date)), 120);
}

function quarterlyDairySeries(rows: Row[], dataItem: string) {
  return last(rows
    .filter((row) => row.Data_item === dataItem && Number(row.Timeperiod_id) >= 13 && Number(row.Timeperiod_id) <= 16)
    .map((row) => quarterPoint(row.Year, row.Timeperiod_id, Number(row.Value.replaceAll(",", ""))))
    .filter((candidate) => Number.isFinite(candidate.value))
    .sort((a, b) => a.date.localeCompare(b.date)), 42);
}

function beefSeries(rows: Row[], dataItem: string) {
  return rows
    .filter((row) => Number(row.Period_Number) >= 1 && Number(row.Period_Number) <= 12 && row.Data_Item === dataItem)
    .map((row) => point(monthDate(row.Year, row.Period_Number), Number(row.Value.replaceAll(",", "")) / 100))
    .filter((candidate) => Number.isFinite(candidate.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const [faoText, dairyText, quarterlyText, beefText] = await Promise.all([
  load("fao"), load("dairy"), load("quarterly"), load("beef")
]);
const faoRows = records(parseCsv(faoText), "Date");
const dairyRows = records(parseCsv(dairyText), "Year");
const quarterlyRows = records(parseCsv(quarterlyText), "Year");
const beefRows = records(parseCsv(beefText), "Year");
const refreshDate = argument("as-of") ?? new Date().toISOString().slice(0, 10);

const dashboard = {
  updatedAt: refreshDate,
  charts: [
    {
      id: "global-price-indices",
      sector: "Global markets",
      region: "International",
      title: "Global dairy and meat prices",
      question: "Are international dairy and meat markets strengthening or easing?",
      description: "FAO monthly commodity price indices over the last ten years.",
      period: "10 years",
      cadence: "Monthly",
      basis: "International commodity price index, with the 2014–2016 average equal to 100.",
      unit: "index points",
      format: "decimal-1",
      updatedAt: refreshDate,
      sourceId: "fao-faostat",
      sourceUrl: sourceUrls.fao,
      sourceTitle: "FAO Food Price Index monthly data",
      note: "FAO can revise previously published values. The dashboard retains the latest values in the current official file.",
      series: [
        {
          label: "Dairy",
          definition: "International quotations for butter, cheese, skim milk powder, and whole milk powder.",
          color: "#2f6d56",
          points: faoSeries(faoRows, "Dairy")
        },
        {
          label: "Meat",
          definition: "International quotations for bovine, ovine, pig, and poultry meat.",
          color: "#89583f",
          points: faoSeries(faoRows, "Meat")
        }
      ]
    },
    {
      id: "us-all-milk-price",
      sector: "Dairy",
      region: "United States",
      title: "U.S. all-milk price",
      question: "How has the national milk-price environment changed?",
      description: "Monthly average price received by U.S. producers for all milk at the average milk-fat test.",
      period: "13 months",
      cadence: "Monthly",
      basis: "National dollars per hundredweight. This is an industry average, not an individual producer’s milk check.",
      unit: "dollars per hundredweight",
      format: "currency-2",
      updatedAt: refreshDate,
      sourceId: "usda-ers-dairy",
      sourceUrl: sourceUrls.dairy,
      sourceTitle: "USDA ERS U.S. dairy situation at a glance",
      note: "Monthly prices are national averages and do not include regional basis, component premiums, deductions, or individual farm costs.",
      series: [
        {
          label: "All-milk price",
          definition: "Average price received by U.S. producers for all milk sold during the month.",
          color: "#2f6d56",
          points: dairySeries(dairyRows, "Milk prices", "All milk (at average milk-fat test)")
        }
      ]
    },
    {
      id: "us-milk-production",
      sector: "Dairy",
      region: "United States",
      title: "U.S. milk production",
      question: "Is the national milk supply expanding or contracting?",
      description: "Quarterly U.S. milk production over the last ten years, including the recurring seasonal pattern.",
      period: "10 years",
      cadence: "Quarterly",
      basis: "National production in millions of pounds. Quarter-to-quarter comparisons are seasonal; year-over-year change is the cleaner signal.",
      unit: "million pounds",
      format: "integer",
      updatedAt: refreshDate,
      sourceId: "usda-ers-dairy",
      sourceUrl: sourceUrls.quarterly,
      sourceTitle: "USDA ERS quarterly U.S. milk production data",
      note: "Use year-over-year change to separate underlying supply movement from normal seasonal production patterns. Quarterly totals are not directly comparable with monthly totals.",
      series: [
        {
          label: "Milk production",
          definition: "Total milk produced in the United States during the reporting quarter.",
          color: "#526884",
          points: quarterlyDairySeries(quarterlyRows, "Milk production")
        }
      ]
    },
    {
      id: "us-beef-retail-values",
      sector: "Meat",
      region: "United States",
      title: "U.S. retail beef values",
      question: "How quickly are national beef values moving at retail?",
      description: "Monthly national Choice and all-fresh beef retail values over the available two-year window.",
      period: "24 months",
      cadence: "Monthly",
      basis: "National average dollars per pound of retail equivalent, converted from the source series reported in cents per pound.",
      unit: "dollars per pound",
      format: "currency-2",
      updatedAt: refreshDate,
      sourceId: "usda-ers-livestock",
      sourceUrl: sourceUrls.beef,
      sourceTitle: "USDA ERS Choice beef values and spreads",
      note: "The source combines BLS retail data with USDA AMS livestock and wholesale market reporting. Values are national averages.",
      series: [
        {
          label: "Choice beef",
          definition: "Retail-equivalent value for Choice-grade beef from a standardized animal and cutting profile.",
          color: "#89583f",
          points: beefSeries(beefRows, "Choice beef retail value")
        },
        {
          label: "All-fresh beef",
          definition: "BLS-derived average retail value for fresh beef sold to U.S. consumers.",
          color: "#b28664",
          points: beefSeries(beefRows, "All-fresh beef retail value")
        }
      ]
    },
    {
      id: "us-cattle-snapshots",
      sector: "Meat",
      region: "United States",
      title: "U.S. cattle supply",
      question: "What is changing in the domestic cattle base?",
      description: "July 1 inventory and annual calf-crop estimates for 2025 and 2026.",
      period: "Annual snapshots",
      cadence: "Annual",
      basis: "USDA national estimates in millions of animals. Beef cows are a July 1 inventory; calf crop covers the calendar year.",
      unit: "million head",
      format: "decimal-1",
      updatedAt: refreshDate,
      sourceId: "usda-nass",
      sourceUrl: "https://data.nass.usda.gov/Newsroom/2026/07-24-2026.php",
      sourceTitle: "USDA NASS cattle inventory releases",
      note: "July cattle inventory reporting was not conducted in 2024. No value is interpolated for that missing release.",
      series: [
        {
          label: "Beef cows",
          definition: "Cows and heifers that have calved and are kept for beef production, estimated on July 1.",
          color: "#89583f",
          points: [point("2025-07", 28.7), point("2026-07", 28.5)]
        },
        {
          label: "Calf crop",
          definition: "Calves born during the calendar year, reported as USDA’s annual national estimate.",
          color: "#526884",
          points: [point("2025-07", 33.1), point("2026-07", 32.5)]
        },
        {
          label: "Cattle on feed",
          definition: "Cattle being fed a concentrated ration for slaughter in U.S. feedlots on the reporting date.",
          color: "#2f6d56",
          points: [point("2025-07", 13.0), point("2026-07", 13.2)]
        }
      ]
    }
  ]
};

const output = `${JSON.stringify(dashboard, null, 2)}\n`;
if (process.argv.includes("--write")) {
  const destination = resolve("src/data/history.json");
  let nextOutput = output;
  if (existsSync(destination)) {
    const previous = JSON.parse(readFileSync(destination, "utf8")) as typeof dashboard;
    const withoutRefreshDates = (value: typeof dashboard) => ({
      ...value,
      updatedAt: "",
      charts: value.charts.map((chart) => ({ ...chart, updatedAt: "" }))
    });
    if (JSON.stringify(withoutRefreshDates(previous)) === JSON.stringify(withoutRefreshDates(dashboard))) {
      dashboard.updatedAt = previous.updatedAt;
      dashboard.charts.forEach((chart, index) => { chart.updatedAt = previous.charts[index]?.updatedAt ?? previous.updatedAt; });
      nextOutput = `${JSON.stringify(dashboard, null, 2)}\n`;
    }
  }
  writeFileSync(destination, nextOutput);
  console.log(`Updated ${destination}`);
} else {
  process.stdout.write(output);
}
