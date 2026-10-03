// Page key (routes.js `page`) → component.
import Home from "./home";
import { Pricing } from "./pricing";
import { Platform, Crm, Volunteer, Agent, Connections, Onboarding, Features, Feature } from "./product";
import { Why, Move, MoveSpreadsheet, MoveCrm, MoveGivingPlatform, For, Audience, Security, About, Leadership, Partners, Contact, Demo } from "./why";
import { Status, Subprocessors, YourData, Dpa } from "./trust";
import { Tools, ToolLostAndFound, ToolRetention, ToolLapsed, ToolThermometer, ToolLybuntFinder, ToolThankYouLetter } from "./tools";
import { Resources, Guides, Guide, Templates, Articles, Article, Glossary, GlossaryTerm, Faq, Help, HelpArticle, WhatsNew, Research, LegalPrivacy, LegalTerms, LegalAccessibility } from "./resources";

export const PAGES = {
  home: Home, pricing: Pricing,
  platform: Platform, crm: Crm, volunteer: Volunteer, agent: Agent, connections: Connections, onboarding: Onboarding,
  features: Features, feature: Feature,
  why: Why, leadership: Leadership, move: Move, moveSpreadsheet: MoveSpreadsheet, moveCrm: MoveCrm, moveGivingPlatform: MoveGivingPlatform,
  for: For, audience: Audience, security: Security, about: About, partners: Partners, contact: Contact, demo: Demo,
  resources: Resources, guides: Guides, guide: Guide, templates: Templates, articles: Articles, article: Article,
  glossary: Glossary, glossaryTerm: GlossaryTerm, faq: Faq, help: Help, helpArticle: HelpArticle, whatsNew: WhatsNew,
  tools: Tools, toolLostAndFound: ToolLostAndFound, toolRetention: ToolRetention, toolLapsed: ToolLapsed, toolThermometer: ToolThermometer, toolLybunt: ToolLybuntFinder, toolThankYou: ToolThankYouLetter, research: Research,
  status: Status, subprocessors: Subprocessors, yourData: YourData, dpa: Dpa,
  legalPrivacy: LegalPrivacy, legalTerms: LegalTerms, legalAccessibility: LegalAccessibility,
};
