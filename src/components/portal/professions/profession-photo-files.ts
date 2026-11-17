import type { StaticImageData } from "next/image";

import accountant from "../../../content/professions/photos/accountant.webp";
import aerospaceEngineer from "../../../content/professions/photos/aerospace-engineer.webp";
import architect from "../../../content/professions/photos/architect.webp";
import chemicalEngineer from "../../../content/professions/photos/chemical-engineer.webp";
import cybersecuritySpecialist from "../../../content/professions/photos/cybersecurity-specialist.webp";
import dataScientist from "../../../content/professions/photos/data-scientist.webp";
import financialAnalyst from "../../../content/professions/photos/financial-analyst.webp";
import graphicDesigner from "../../../content/professions/photos/graphic-designer.webp";
import hotelManager from "../../../content/professions/photos/hotel-manager.webp";
import interfaceDesigner from "../../../content/professions/photos/interface-designer.webp";
import internationalRelationsAnalyst from "../../../content/professions/photos/international-relations-analyst.webp";
import languageTeacher from "../../../content/professions/photos/language-teacher.webp";
import lawyer from "../../../content/professions/photos/lawyer.webp";
import logisticsSpecialist from "../../../content/professions/photos/logistics-specialist.webp";
import maritimeOfficer from "../../../content/professions/photos/maritime-officer.webp";
import marketingManager from "../../../content/professions/photos/marketing-manager.webp";
import mechanicalEngineer from "../../../content/professions/photos/mechanical-engineer.webp";
import nurse from "../../../content/professions/photos/nurse.webp";
import paramedic from "../../../content/professions/photos/paramedic.webp";
import physician from "../../../content/professions/photos/physician.webp";
import projectManager from "../../../content/professions/photos/project-manager.webp";
import softwareDeveloper from "../../../content/professions/photos/software-developer.webp";
import tourGuide from "../../../content/professions/photos/tour-guide.webp";
import translator from "../../../content/professions/photos/translator.webp";

/**
 * Фото профессий для карточек итога Эви (17.11.2026, по просьбе пользователя): по одному снимку на каждую из 24 карточек
 * каталога (миграция 359). Сгенерированы в Google Flow (Nano Banana), как обложки уроков английского, — не места и не
 * кампусы, поэтому без атрибуции; до выпуска нужно слово владельца (контракт кабинета, принцип 2). WebP 720 × 405.
 * Статический импорт: хеш в имени и долгий кэш. Ключ — cardKey карточки каталога; нет ключа — карточка без фото.
 */
export const PROFESSION_PHOTOS: Readonly<Record<string, StaticImageData>> = Object.freeze({
  "accountant": accountant,
  "aerospace-engineer": aerospaceEngineer,
  "architect": architect,
  "chemical-engineer": chemicalEngineer,
  "cybersecurity-specialist": cybersecuritySpecialist,
  "data-scientist": dataScientist,
  "financial-analyst": financialAnalyst,
  "graphic-designer": graphicDesigner,
  "hotel-manager": hotelManager,
  "interface-designer": interfaceDesigner,
  "international-relations-analyst": internationalRelationsAnalyst,
  "language-teacher": languageTeacher,
  "lawyer": lawyer,
  "logistics-specialist": logisticsSpecialist,
  "maritime-officer": maritimeOfficer,
  "marketing-manager": marketingManager,
  "mechanical-engineer": mechanicalEngineer,
  "nurse": nurse,
  "paramedic": paramedic,
  "physician": physician,
  "project-manager": projectManager,
  "software-developer": softwareDeveloper,
  "tour-guide": tourGuide,
  "translator": translator,
});
