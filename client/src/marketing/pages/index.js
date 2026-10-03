// Page key (routes.js `page`) → component.
import Home from "./home";
import { Pricing } from "./pricing";
import { Platform, Crm, Volunteer, Agent, Connections, Onboarding, Features, Feature } from "./product";
import { Why, Move, MoveSpreadsheet, MoveCrm, For, Audience, Security, About, Leadership, Partners, Contact, Demo } from "./why";
import { Status, Subprocessors, YourData, Dpa } from "./trust";
import { Resources, Guides, Guide, Templates, Articles, Article, StateOfRetention, Glossary, Faq, Help, HelpArticle, WhatsNew, Tools, ToolLostAndFound, ToolRetention, ToolLapsed, ToolThermometer, Research, LegalPrivacy, LegalTerms, LegalAccessibility } from "./resources";

export const PAGES = {
  home: Home, pricing: Pricing,
  platform: Platform, crm: Crm, volunteer: Volunteer, agent: Agent, connections: Connections, onboarding: Onboarding,
  features: Features, feature: Feature,
  why: Why, leadership: Leadership, move: Move, moveSpreadsheet: MoveSpreadsheet, moveCrm: MoveCrm,
  for: For, audience: Audience, security: Security, about: About, partners: Partners, contact: Contact, demo: Demo,
  resources: Resources, guides: Guides, guide: Guide, templates: Templates, articles: Articles, article: Article, stateOfRetention: StateOfRetention,
  glossary: Glossary, faq: Faq, help: Help, helpArticle: HelpArticle, whatsNew: WhatsNew,
  tools: Tools, toolLostAndFound: ToolLostAndFound, toolRetention: ToolRetention, toolLapsed: ToolLapsed, toolThermometer: ToolThermometer, research: Research,
  status: Status, subprocessors: Subprocessors, yourData: YourData, dpa: Dpa,
  legalPrivacy: LegalPrivacy, legalTerms: LegalTerms, legalAccessibility: LegalAccessibility,
};
