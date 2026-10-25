(function (global) {
  "use strict";
  const rules = [
    [/meat\s*loaf|meatloaf|steak|beef|veal/i, "牛肉类主食"],
    [/pork|ham|bacon|sausage/i, "猪肉类"],
    [/chicken|turkey|duck|poultry/i, "鸡肉类"],
    [/fish|salmon|tuna|shrimp|prawn|crab|lobster|seafood/i, "鱼虾类"],
    [/rice|risotto|paella|sushi/i, "米饭类餐食"],
    [/noodle|ramen|pasta|spaghetti|macaroni|udon|chow mein/i, "面食类"],
    [/bread|bagel|beigel|toast|bun|pizza|sandwich/i, "面包主食类"],
    [/salad|vegetable|broccoli|cabbage|spinach|guacamole/i, "蔬菜类"],
    [/fruit|apple|banana|orange|berry|watermelon/i, "水果类"],
    [/egg|milk|cheese|yogurt|dairy/i, "蛋奶类"],
    [/soup|stew|hotpot|burrito|wrap|plate|meal|dish/i, "混合餐食"]
  ];
  const allowed = ["牛肉类主食", "面食类", "米饭类餐食", "鱼虾类", "蔬菜类", "水果类", "混合餐食", "猪肉类", "鸡肉类", "蛋奶类", "面包主食类"];
  const forbidden = /温泉蛋|盖饭|套餐|宫保|鱼香|水煮|红烧|清蒸|汉堡|披萨|寿司|拉面|炒饭|沙拉$/;
  function translateTop5(name) {
    const text = String(name || "").trim();
    if (!text) return "混合餐食";
    if (/^[\u3400-\u9fff]/.test(text)) return normalizeCategory(text);
    const hit = rules.find(([pattern]) => pattern.test(text));
    return hit ? hit[1] : "混合餐食";
  }
  function normalizeCategory(value) {
    const text = String(value || "").trim();
    if (allowed.includes(text)) return text;
    if (/牛|beef/i.test(text)) return "牛肉类主食";
    if (/面|粉|noodle|pasta/i.test(text)) return "面食类";
    if (/米|饭|rice/i.test(text)) return "米饭类餐食";
    if (/鱼|虾|蟹|seafood|fish/i.test(text)) return "鱼虾类";
    if (/菜|蔬|salad|vegetable/i.test(text)) return "蔬菜类";
    if (/果|fruit/i.test(text)) return "水果类";
    if (/鸡|禽|chicken/i.test(text)) return "鸡肉类";
    if (/猪|pork/i.test(text)) return "猪肉类";
    if (/蛋|奶|egg|dairy/i.test(text)) return "蛋奶类";
    return forbidden.test(text) ? "混合餐食" : translateTop5(text);
  }
  global.AIYingBaoLabels = { translateTop5, normalizeCategory };
})(window);
