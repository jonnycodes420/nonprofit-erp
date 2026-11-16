// shared/numbers/answerUnit.js · FLOWS-15 item 3 (W-1116-Atlas-01X). AN ANSWER'S FIGURE
// CARRIES ITS UNIT FROM THE SOURCE THAT PRODUCED IT.
//
// Asked "What is Linwood Foundation's lifetime giving?", Atlas answered "$6,523 in 1 person"
// and then drew "Lifetime $6,523 / 6,523 people, 6,522 more in the list." Ask's query layer
// (routes/why.js) set the answer's peopleCount to its headline VALUE whenever the question was
// about people, so a sum of money ($6,523) became a count of people (6,523), and Atlas's list
// (server/atlas/answers.js) read that as how many people matched.
//
// THE RULE, read by Ask and by Atlas:
//   · The headline's unit is the field's: money for a money field, a date for a date field,
//     otherwise a count. (unitOfField)
//   · How many PEOPLE an answer is about is a count of people, and only that: the value when
//     the measure counts people, the rows counted when it sums, averages or ranks people,
//     and the people listed otherwise. Never a money or date value. (peopleCountOf)
//   · A money or date answer about one person is that figure, not a list of one.
//     (isPeopleList)
// Pure: no DB, no clock.
"use strict";

const UNITS = ["money", "count", "date", "people"];

// The unit of a field by its Ask type (askQuery.js T.money / T.date / T.number / T.text).
function unitOfField(fd) {
  const t = fd && (fd.type || fd.kind);
  return t === "money" ? "money" : t === "date" ? "date" : "count";
}

// How many people the answer is about. fn: the measure (count, count_people, sum, avg, max,
// min); entity: what was counted; value: the headline; rows: how many rows the measure read;
// listed: how many people the answer carries.
function peopleCountOf({ fn, entity, value, rows, listed }) {
  const n = x => (Number.isFinite(Number(x)) ? Number(x) : null);
  if (fn === "count_people") return n(value) ?? n(listed);
  if (entity === "people") {
    if (["sum", "avg", "max", "min"].includes(fn)) return n(rows) ?? n(listed);
    return n(value) ?? n(listed);   // a count of people records
  }
  return n(listed);
}

// The headline figure's unit on an Ask answer, read from the figure itself.
function headlineUnit(ask) {
  const v = ask && ask.figures && ask.figures.value;
  if (!v) return null;
  return v.kind === "money" ? "money" : v.kind === "date" ? "date" : "count";
}

// The number of people an Ask answer names, for Atlas's list: peopleCount when Ask gave one;
// `count` only when the headline is not money or a date; else the people carried.
function answerPeopleCount(ask, carried) {
  if (!ask) return carried;
  if (ask.peopleCount != null && Number.isFinite(Number(ask.peopleCount))) return Number(ask.peopleCount);
  const u = headlineUnit(ask);
  if (ask.count != null && u !== "money" && u !== "date" && Number.isFinite(Number(ask.count))) return Number(ask.count);
  return carried;
}

// Whether the answer is a list of people: more than one, or a count of people. A money or date
// answer about one person is its figure.
function isPeopleList(ask, count) {
  const u = headlineUnit(ask);
  if ((u === "money" || u === "date") && count <= 1) return false;
  return count >= 1;
}

module.exports = { UNITS, unitOfField, peopleCountOf, headlineUnit, answerPeopleCount, isPeopleList };
