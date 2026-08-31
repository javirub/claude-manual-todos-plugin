import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <div className="detail-empty" style={{ height: "100dvh" }}>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
      <Link className="chip" href="/">
        {t("action")}
      </Link>
    </div>
  );
}
