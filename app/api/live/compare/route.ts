import {compareBasket} from "@/lib/compare-basket";
export async function POST(request:Request) {return compareBasket(request);}
