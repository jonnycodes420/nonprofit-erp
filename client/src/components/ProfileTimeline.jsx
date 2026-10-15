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

// PROFILE-1 (header) — the tasks, files and volunteer shifts beside the
// timeline, read ONCE per profile: the tab row's counts and every tab's list
// come from the same three reads.
export function useTimelineExtras(donorId, ints) {
  const [tasks, setTasks] = useState([]);
  const [attachments, setAttachments] = useState([]);
  // PARITY-3 Part 1 — every logged shift is on the timeline as Volunteer service.
  const [service, setService] = useState([]);
  // FIX-22 · the files follow the interactions (an email that arrives carries
  // its attachments), so they reload when the list changes. Tasks and volunteer
  // hours do not, and used to reload with it: every profile asked twice.
  useEffect(() => {
    if (!donorId) return undefined;
    let alive = true;
    const loadFiles = () => apiFetch(`/donors/${donorId}/attachments`)
      .then(r => { if (alive) setAttachments(Array.isArray(r && r.attachments) ? r.attachments : []); })
      .catch(() => { if (alive) setAttachments([]); });
    loadFiles();
    const on = () => loadFiles();
    window.addEventListener(ATTACHMENTS_CHANGED, on);
    return () => { alive = false; window.removeEventListener(ATTACHMENTS_CHANGED, on); };
  }, [donorId, ints]);
  useEffect(() => {
    if (!donorId) return undefined;
    let alive = true;
    apiFetch(`/donors/${donorId}/tasks`)
      .then(r => { if (alive) setTasks(Array.isArray(r) ? r : []); })
      .catch(() => { if (alive) setTasks([]); });
    const loadService = () => apiFetch(`/donors/${donorId}/volunteer-hours`)
      .then(r => { if (alive) setService(Array.isArray(r && r.shifts) ? r.shifts : []); })
      .catch(() => { if (alive) setService([]); });
    loadService();
    window.addEventListener(VOLUNTEER_HOURS_CHANGED, loadService);
    return () => { alive = false; window.removeEventListener(VOLUNTEER_HOURS_CHANGED, loadService); };
  }, [donorId]);
  return { tasks, attachments, service };
}

export function ProfileTimeline({ extras = null, ...props }) {
  if (extras) return <RelationshipTimeline {...props} tasks={extras.tasks} attachments={extras.attachments} service={extras.service}/>;
  return <OwnExtras {...props}/>;
}
function OwnExtras(props) {
  const extras = useTimelineExtras(props.donor && props.donor.id, props.interactions);
  return <RelationshipTimeline {...props} tasks={extras.tasks} attachments={extras.attachments} service={extras.service}/>;
}

export default ProfileTimeline;
