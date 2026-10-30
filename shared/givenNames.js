// shared/givenNames.js · IMPORT-5. Common first names, lower case, for one
// question only: is this word a first name? It tells a couple written with a
// comma ("Alex, Brad Hollins": two first names and a surname) from "Last,
// First". A name missing here only means Steward keeps reading "Last, First"
// as before; it never makes a couple of a name it does not know.
const LIST = `
aaron abby abigail ada adam adrian adrienne aiden al alan albert alec alex alexa alexander alexandra alexis alfred alice alicia alison allen allie allison alma amanda amber amelia amy ana andrea andrew andy angela angie anita ann anna anne annette annie anthony april archie arlene arthur ashley audrey austin ava avery
barbara barry becky ben benjamin bernard bert beth betsy betty beverly bill billy blake bob bobby bonnie brad bradley brandi brandon brenda brent brett brian bridget brittany brooke bruce bryan bud
caleb calvin cameron camille candace carl carla carlos carmen carol carole caroline carolyn carrie casey cassie catherine cathy chad charlene charles charlie charlotte chase chelsea cheryl chris christi christian christina christine christopher chuck cindy claire clara clarence claude claudia clay clayton cliff clifford clint cody colin colleen connie connor corey cory courtney craig crystal curtis cynthia
dale dan dana daniel danielle danny darlene darrell daryl dave david dawn dean debbie deborah debra denise dennis derek diana diane dianne dick dolores dominic don donald donna doris dorothy doug douglas drew duane dustin dwight dylan
earl ed eddie edgar edith edna edward edwin eileen elaine eleanor eli elijah elizabeth ella ellen ellie elsie emily emma eric erica erik erin ernest esther ethan eugene eva evan evelyn
faith fay felicia fern florence frances francis frank franklin fred freddie frederick
gail gary gavin gene geneva george georgia gerald geraldine gina ginger ginny glen glenda glenn gloria gordon grace grant greg gregory gretchen gwen
hal hank hannah harold harriet harry hazel heather heidi helen henry herbert herman holly howard hugh
ian ida irene iris isaac isabel isabella ivan
jack jackie jacob jacqueline jake james jamie jan jane janet janice jared jasmine jason jay jean jeanette jeanne jeff jeffrey jenna jennifer jenny jeremy jerry jesse jessica jill jim jimmy jo joan joann joanne jodi joe joel joey john johnny jon jonathan jordan joseph josephine josh joshua joy joyce juan judith judy julia julie june justin
karen kari karl kate katelyn katherine kathleen kathryn kathy katie kay keith kelley kelli kellie kelly ken kendra kenneth kent kerry kevin kim kimberly kirk kristen kristin kristina kristy kurt kyle
lance larry laura lauren laurie leah lee leigh lena leo leon leonard leroy leslie lewis lillian lily linda lindsay lindsey lisa liz liza lloyd logan lois lonnie lori lorraine louis louise lucas lucille lucy luke lydia lynn
mabel mackenzie madison maggie mandy marcia marcus margaret margie maria marian marie marilyn marion marjorie mark marlene marsha marshall martha martin marvin mary mason matt matthew maureen max maxine megan melanie melinda melissa melvin meredith mia michael michele michelle mickey mike mildred miles milton mindy miranda misty mitch mitchell molly monica morgan muriel myra myrtle
nancy naomi natalie nathan nathaniel neal neil nellie nicholas nick nicole nina noah nora norma norman
olive olivia oscar owen
pam pamela pat patricia patrick patsy patti patty paul paula pauline peggy penny pete peter phil philip phillip phyllis polly priscilla
rachel ralph randall randy ray raymond rebecca regina renee rhonda ricardo richard rick ricky rita rob robbie robert roberta robin rodney roger ron ronald ronnie rosa rose rosemary ross roy ruby russell ruth ryan
sabrina sadie sally sam samantha samuel sandra sandy sara sarah scott sean seth shane shannon sharon shawn sheila shelby shelly sherri sherry shirley sidney sophia sophie stacey stacy stan stanley stella stephanie stephen steve steven stuart sue susan susie suzanne sylvia
tamara tammy tanya tara ted teddy teresa terri terry theodore theresa thomas tiffany tim timothy tina todd tom tommy toni tony tracey traci tracy travis trevor troy tyler
valerie vanessa vera vernon veronica vicki vicky victor victoria vincent viola violet virginia vivian
wade walt walter wanda warren wayne wendy wesley whitney will william willie wilma
yolanda yvonne
zach zachary zoe
`;
export const GIVEN_NAMES = new Set(LIST.split(/\s+/).filter(Boolean));
export function isGivenName(w) { return GIVEN_NAMES.has(String(w || "").toLowerCase().replace(/[^a-z'’-]/g, "")); }
