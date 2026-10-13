/** Code in bold, then the name on the same line, cut with "…" when long (the whole name in the tooltip), so rows keep one line. */
export function InstrumentLabel({ code, name }: { code: string; name: string }) {
  return (
    <>
      <strong>{code}</strong>
      {name !== code && (
        <>
          {" "}
          <span className="muted name" title={name}>
            {name}
          </span>
        </>
      )}
    </>
  );
}
