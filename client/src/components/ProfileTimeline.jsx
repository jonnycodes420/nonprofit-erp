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
import { VOLUNTEER_HOURS_CHANGED } from "./VolunteerPanel";

export function ProfileTimeline(props) {
  const donorId = props.donor && props.donor.id;
  const [tasks, setTasks] = useState([]);
  const [attachments, setAttachments] = useState([]);
  // PARITY-3 Part 1 — every logged shift is on the timeline as Volunteer service.
  const [service, setService] = useState([]);
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
    const loadService = () => apiFetch(`/donors/${donorId}/volunteer-hours`)
      .then(r => { if (alive) setService(Array.isArray(r && r.shifts) ? r.shifts : []); })
      .catch(() => { if (alive) setService([]); });
    loadFiles();
    loadService();
    const on = () => loadFiles();
    window.addEventListener(ATTACHMENTS_CHANGED, on);
    window.addEventListener(VOLUNTEER_HOURS_CHANGED, loadService);
    return () => { alive = false; window.removeEventListener(ATTACHMENTS_CHANGED, on); window.removeEventListener(VOLUNTEER_HOURS_CHANGED, loadService); };
  }, [donorId, ints]);
  return <RelationshipTimeline {...props} tasks={tasks} attachments={attachments} service={service}/>;
}

export default ProfileTimeline;
