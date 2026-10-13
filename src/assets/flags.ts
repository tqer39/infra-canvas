import JP from './flags/jp.svg';
import US from './flags/us.svg';
import CA from './flags/ca.svg';
import BR from './flags/br.svg';
import MX from './flags/mx.svg';
import CL from './flags/cl.svg';
import GB from './flags/gb.svg';
import DE from './flags/de.svg';
import IE from './flags/ie.svg';
import FR from './flags/fr.svg';
import IT from './flags/it.svg';
import ES from './flags/es.svg';
import SE from './flags/se.svg';
import CH from './flags/ch.svg';
import BE from './flags/be.svg';
import NL from './flags/nl.svg';
import FI from './flags/fi.svg';
import PL from './flags/pl.svg';
import NO from './flags/no.svg';
import AT from './flags/at.svg';
import DK from './flags/dk.svg';
import AU from './flags/au.svg';
import NZ from './flags/nz.svg';
import IN from './flags/in.svg';
import KR from './flags/kr.svg';
import SG from './flags/sg.svg';
import ID from './flags/id.svg';
import MY from './flags/my.svg';
import TH from './flags/th.svg';
import TW from './flags/tw.svg';
import HK from './flags/hk.svg';
import ZA from './flags/za.svg';
import BH from './flags/bh.svg';
import AE from './flags/ae.svg';
import IL from './flags/il.svg';
import QA from './flags/qa.svg';
import SA from './flags/sa.svg';

const flags: Record<string, string> = {
  JP,
  US,
  CA,
  BR,
  MX,
  CL,
  GB,
  DE,
  IE,
  FR,
  IT,
  ES,
  SE,
  CH,
  BE,
  NL,
  FI,
  PL,
  NO,
  AT,
  DK,
  AU,
  NZ,
  IN,
  KR,
  SG,
  ID,
  MY,
  TH,
  TW,
  HK,
  ZA,
  BH,
  AE,
  IL,
  QA,
  SA,
};
export const getCountryFlag = (code: string): string | undefined => flags[code];
