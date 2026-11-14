/** Renders copy where `backtick` tokens are code or Latin terms, isolated left-to-right inside Arabic text. */
export default function Rich({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <bdi key={i} dir="ltr">
            <code>{part}</code>
          </bdi>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Copy as plain text (emails, metadata). */
export const plain = (text: string) => text.replace(/`/g, "");
