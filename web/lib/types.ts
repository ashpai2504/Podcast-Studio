export type Speaker = "host1" | "host2";

export interface Turn {
  speaker: Speaker;
  text: string;
}

export interface Script {
  title: string;
  turns: Turn[];
}
