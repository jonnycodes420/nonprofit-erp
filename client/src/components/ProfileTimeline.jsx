// client/src/components/ProfileTimeline.jsx — PARITY-1 Part B.
//
// The profile's ONE timeline ("Everything with …"): RelationshipTimeline
// (MeetingPanels.jsx) with the person's tasks and the files on their
// conversations and notes loaded beside it. It takes every prop
// RelationshipTimeline takes, so the profile swaps one name for the other.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { RelationshipTimeline } from "./MeetingPanels";
import { ATTACHMENTS_CHANGED } from "./ProfileTimelineParts";

export function ProfileTimeline(props) {
  const donorId = props.donor && props.donor.id;
  const [tasks, setTasks] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const ints = props.interactions;
  useEffect(() => {
    if (!donorId) return undefined;
    let alive = true;
    const loadFiles = () => apiFetch(`/donors/${donorId}/attachments`)
      .then(r => { if (alive) setAttachments(Array.isArray(r && r.attachments) ? r.attachments : []); })
      .catch(() => { if (alive) setAttachments([]); });
    apiFetch(`/donors/${donorId}/tasks`)
      .then(r => { if (alive) setTasks(Array.isArray(r) ? r : []); })
      .catch(() => { if (alive) setTasks([]); });
    loadFiles();
    const on = () => loadFiles();
    window.addEventListener(ATTACHMENTS_CHANGED, on);
    return () => { alive = false; window.removeEventListener(ATTACHMENTS_CHANGED, on); };
  }, [donorId, ints]);
  return <RelationshipTimeline {...props} tasks={tasks} attachments={attachments}/>;
}

export default ProfileTimeline;
