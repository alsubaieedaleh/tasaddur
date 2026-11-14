import Link from "next/link";
import { getT } from "@/lib/i18n";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <section className="section">
      <div className="container narrow center">
        <h1>{t.notFound}</h1>
        <p>
          <Link className="btn" href="/">
            {t.backHome}
          </Link>
        </p>
      </div>
    </section>
  );
}
