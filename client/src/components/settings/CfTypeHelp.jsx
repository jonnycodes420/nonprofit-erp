import { T } from "../shared";

// The line under "Field type" in Settings → Custom fields: what the type is
// good for (LIST-4: a Number sorts and filters, so it is the one for a score),
// and, once the field exists, why its type is fixed.
const TYPE_HELP = {
  number: "Good for scores: filter by value, sort high to low.",
};

export function CfTypeHelp({ type, editing }) {
  const help = TYPE_HELP[type];
  return (
    <>
      {help && <div data-testid="cf-type-help" style={{ fontSize: 11.5, color: T.ink3, marginTop: editing ? 0 : -10, marginBottom: editing ? 6 : 14, lineHeight: 1.5 }}>{help}</div>}
      {editing && <div style={{ fontSize: 11.5, color: T.ink3, marginBottom: 14, lineHeight: 1.5 }}>
        A field's type can't change after creation, changing it would silently rewrite every saved value. Archive this field and add a new one instead.
      </div>}
    </>
  );
}
