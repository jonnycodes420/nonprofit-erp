// LettersButton.jsx · LETTERS-1 item 3. "Letters for everyone who gave", from an
// event's page or a campaign's page: it opens Communications → Printed letters
// with that event or campaign already chosen.
import { useNavigate } from "react-router-dom";
import { tabHref } from "../../lib/appUrls";
import { lettersFor } from "./PrintedLetters";

export default function LettersButton({ eventId = null, campaignId = null, style, testid = "letters-for-everyone" }) {
  const navigate = useNavigate();
  const go = () => { lettersFor(eventId ? { eventId } : { campaignId }); navigate(tabHref("communications", { subtab: "letters" })); };
  return <button type="button" onClick={go} data-testid={testid} style={style}>Letters for everyone who gave</button>;
}
