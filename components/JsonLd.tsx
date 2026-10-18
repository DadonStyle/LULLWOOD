// One <script type="application/ld+json"> block. Server-rendered so crawlers
// read it from the initial HTML; `<` is escaped so a string in the data can
// never close the script tag early.
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
