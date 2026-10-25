(function () {
  "use strict";
  const DEFAULT_API = "https://aiyingbao2026.onrender.com/api/vision-recognition";
  const MAX_IMAGE_SIDE = 1600;
  const JPEG_QUALITY = 0.82;
  const REQUEST_TIMEOUT_MS = 120000;
  const API = window.AIYINGBAO_API_URL || localStorage.getItem("aiyingbaoApiUrl") || DEFAULT_API;
  const $ = (id) => document.getElementById(id);
  let selectedFile = null;
  let latestMeal = null;
  // Personal targets are kept only for this open page, independently by group.
  const personalProteinTargets = Object.create(null);
  function proteinContextKey() {
    if ($("audience").value === "renal") return "renal:" + $("renalStatus").value;
    if ($("audience").value === "cardio") return "cardio:" + $("cardioSubtype").value;
    if ($("audience").value === "youth" || +$("age").value < 18) return "youth";
    return null;
  }

  $("todayText").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  document.querySelectorAll(".nav a").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".nav a").forEach((item) => item.classList.remove("active")); link.classList.add("active");
  }));


  function getProfileState() {
    return {
      gender: $("gender").value,
      age: +$("age").value,
      height: +$("height").value,
      weight: +$("weight").value,
      goal: $("goal").value,
      activity: +$("activity").value,
      steps: +$("steps").value,
    audience: $("audience").value,
    cardioSubtype: $("cardioSubtype").value,
    renalStatus: $("renalStatus").value
    };
  }

  // Step thresholds are product heuristics, not clinical protein prescriptions.
  function getEffectiveActivity(activity, steps) {
    const tiers = {
      "1.2": { label: "久坐", ratio: 0.8 },
      "1.375": { label: "轻度活动", ratio: 0.9 },
      "1.55": { label: "中度活动", ratio: 1.0 },
      "1.725": { label: "高强度活动", ratio: 1.2 }
    };
    const selected = tiers[String(activity)] || tiers["1.2"];
    const safeSteps = Math.max(0, Number(steps) || 0);
    const stepRatio = safeSteps >= 12000 ? 1.2 : safeSteps >= 8000 ? 1.0 : safeSteps >= 5000 ? 0.9 : 0.8;
    return {
      ratio: Math.max(selected.ratio, stepRatio),
      label: stepRatio > selected.ratio ? "已结合今日步数调整" : selected.label + " · 已参考今日步数"
    };
  }

  function renalIngredientNotices(meal, status) {
    const ingredients = Array.isArray(meal.ingredients)
      ? [...new Set(meal.ingredients.filter(x => typeof x === "string").map(x => x.trim()).filter(x => x && x !== "食材待确认"))].slice(0, 30)
      : [];
    const matches = pattern => ingredients.filter(name => pattern.test(name)).slice(0, 8).join("、");
    const potassium = matches(/香蕉|土豆|马铃薯|番茄|西红柿|菠菜|牛油果|橙|橘|干果|葡萄干|低钠盐|代盐|氯化钾|banana|potato|tomato|spinach|avocado|orange|raisin|potassium chloride/i);
    const phosphorus = matches(/牛奶|酸奶|奶酪|芝士|豆腐|黄豆|豆类|豆浆|坚果|花生|核桃|内脏|肝脏|可乐|磷酸|milk|yogurt|cheese|tofu|soy|bean|nut|peanut|cola|phosph/i);
    const sodium = matches(/咸菜|腌|香肠|火腿|培根|酱油|蚝油|咸鱼|咸肉|罐头|食盐|调味盐|sausage|ham\b|bacon|soy sauce|oyster sauce|pickl|cured|salt\b/i);
    const liquids = matches(/汤|牛奶|酸奶|豆浆|果汁|奶茶|咖啡|饮料|可乐|粥|soup|milk|yogurt|juice|coffee|cola|porridge/i);
    const noMatch = ingredients.length
      ? "本次食材名称未匹配到此类常见来源，不代表含量低或可以放心食用；隐含调味料和识别遗漏仍可能存在。"
      : "尚无可用的食材识别结果，暂不能给出针对本餐的来源提示。";
    const potassiumText = (potassium ? "识别食材：" + potassium + "。这些食材可能提供钾；低钠盐或代盐可能含氯化钾。" : noMatch) + " 肾功能下降时可能发生钾排泄障碍；是否需要限钾取决于血钾、用药及治疗情况，不能仅凭图片判断。";
    const phosphorusText = (phosphorus ? "识别食材：" + phosphorus + "。可能涉及天然磷或含磷添加剂；植物天然磷与添加剂磷的吸收率不同，图片不能确认是否含添加剂。" : noMatch) + " 蛋白质代谢会产生含氮废物，但不等于蛋白食物本身有害。" + (status === "dialysis" ? " 透析可能增加蛋白需求，此提示不表示应限蛋白。" : status === "nondialysis" ? " 未透析者的蛋白需求仍与分期、营养状态有关。" : " 透析状态未确认，不能判断个人蛋白需求。");
    const sodiumText = (sodium ? "识别食材：" + sodium + "。可能含钠，含量受盐、酱料、加工方式和份量影响；钠摄入与液体潴留、血压有关。" : noMatch) + (liquids ? " 本餐可能涉及液体来源：" + liquids + "。" : " 图片无法完整记录饮水和汤汁。") + " 是否需要限液体取决于尿量、水肿及透析情况。";
    return [potassiumText, phosphorusText, sodiumText];
  }

  function updatePersonalizedRecommendations(reasonText) {
    const p = getProfileState();
    const isRenal = p.audience === "renal";
    const meal = latestMeal || {};
    const n = meal.nutrition || {};
    const category = meal.foodCategory || "";

    const calorieGoal = Number($("calorieGoal").textContent) || 0;
    const proteinGoal = Number($("proteinGoal").textContent) || 0;
    const genderLabel = p.gender === "male" ? "男" : "女";

    const audienceLabels = {
      general: "普通人群",
      youth: "儿童青少年",
      older: "老年人",
      sports: "运动人群",
      renal: "肾功能不全",
      cardio: "心血管健康关注人群"
    };
    const audienceLabel = audienceLabels[p.audience] || "普通人群";

    let breakfastTitle = "早餐：均衡开启一天";
    let breakfastText = `今日建议热量约 ${calorieGoal} kcal。早餐可选择蛋类或奶类，搭配主食和水果。`;

    let lunchTitle = "午餐：主食、蛋白和蔬菜都要有";
    let lunchText = proteinGoal > 0
      ? `今日蛋白质目标约 ${proteinGoal} g。午餐建议搭配鱼虾、禽肉或豆制品，并保证足够蔬菜。`
      : "午餐建议搭配鱼虾、禽肉或豆制品，并保证足够蔬菜；蛋白份量按个人方案安排。";

    let dinnerTitle = "晚餐：清淡但不节食";
    let dinnerText = `晚餐减少重油酱汁，保留适量主食和优质蛋白，并结合全天约 ${calorieGoal} kcal 的目标合理安排。`;

    // 推荐对象分层
    if (p.audience === "youth") {
      breakfastTitle = "早餐：成长阶段要吃好";
      breakfastText = "儿童青少年处于生长发育阶段，早餐应包含主食、蛋白质和水果或蔬菜，不建议用零食或饮料代替正餐。";
      lunchTitle = "午餐：种类丰富，保证成长需要";
      lunchText = "午餐建议同时包含主食、肉蛋奶或豆制品和蔬菜，注意食物多样性，不建议随意节食。";
      dinnerTitle = "晚餐：均衡适量，不宜过少";
      dinnerText = "晚餐应保持蔬菜、蛋白质和适量主食的均衡搭配，避免高糖饮料和过多油炸零食。";
    } else if (p.audience === "older") {
      breakfastTitle = "早餐：易消化并保证蛋白质";
      breakfastText = "老年人早餐可选择鸡蛋、牛奶、豆浆等优质蛋白，并搭配较易消化的主食和水果。";
      lunchTitle = "午餐：优质蛋白 + 蔬菜";
      lunchText = "午餐可优先选择鱼、蛋、豆制品等优质蛋白，搭配足量蔬菜和适量主食。";
      dinnerTitle = "晚餐：清淡、适量、不过晚";
      dinnerText = "晚餐宜清淡，避免一次吃得过多，注意蔬菜和优质蛋白的摄入。";
    } else if (p.audience === "sports") {
      breakfastTitle = "早餐：补充能量和蛋白";
      breakfastText = proteinGoal > 0
        ? `运动人群需要较充足的能量和蛋白质。今日蛋白质参考约 ${proteinGoal} g，早餐可增加鸡蛋、牛奶、酸奶或豆制品。`
        : "运动期间注意能量和蛋白质搭配；成长阶段的份量按个人方案安排。";
      lunchTitle = "午餐：主食和优质蛋白都要够";
      lunchText = "活动量较大时，午餐应保证足够主食和鱼、虾、鸡肉、牛肉或豆制品，并注意补水。";
      dinnerTitle = "晚餐：帮助运动后恢复";
      dinnerText = "运动后可适量补充蛋白质和碳水化合物，同时保证蔬菜和水分摄入。";
    } else if (p.audience === "cardio") {
      breakfastTitle = "早餐：清淡、少盐、优质蛋白";
      breakfastText = "心血管健康关注人群早餐可优先选择全谷物、鸡蛋、低脂奶或豆制品，减少高盐加工食品和高糖饮料。";
      lunchTitle = "午餐：少盐少油，多蔬菜和优质蛋白";
      lunchText = "午餐建议多选蔬菜、鱼类、豆类和全谷物，减少腌制食品、加工肉制品、油炸食品和重口味酱汁。";
      dinnerTitle = "晚餐：减少饱和脂肪和高盐食物";
      dinnerText = "晚餐宜清淡，可选择鱼、豆制品和蔬菜，减少肥肉、加工肉、高盐酱料和过量精制主食。";
    }

    const subtypePlans = {
      diabetes: {
        label: "糖尿病", focus: "规律进餐、合理分配主食、减少含糖饮料",
        titles: ["早餐：全谷物搭配蛋白，规律进餐", "午餐：主食合理分配，荤素搭配", "晚餐：均衡搭配，避免跳餐"],
        texts: ["可选择原味燕麦或全麦面包，搭配鸡蛋、无糖豆浆或原味奶；水果适量，减少果汁和含糖饮料。", "可选择杂粮饭、鱼或豆腐和蔬菜；主食份量按个人饮食方案分配，避免只吃菜、不吃主食。", "可选择适量全谷物主食、清淡蔬菜和鱼禽或豆制品；保持规律，不自行跳餐或极端限制主食。"]
      },
      hypertension: {
        label: "高血压", focus: "减少盐和高盐调味品，优先新鲜食物",
        titles: ["早餐：原味少盐，减少腌制食品", "午餐：清淡烹饪，酱料少放", "晚餐：少盐少浓汤，搭配蔬菜"],
        texts: ["可选择燕麦、原味奶或无糖豆浆和鸡蛋；减少咸菜、香肠和其他高盐加工食品。", "可选择杂粮饭、清蒸鱼或豆腐和蔬菜；少放盐、酱油、蚝油及浓酱，酱料单独放。", "可选择适量主食、蔬菜和清淡蛋白质来源；减少腌制品、加工肉以及高盐汤汁。"]
      },
      hyperlipidemia: {
        label: "高血脂", focus: "减少饱和脂肪，增加全谷物、蔬菜和豆类",
        titles: ["早餐：燕麦全麦，减少奶油糕点", "午餐：鱼豆替换部分肥肉", "晚餐：多纤维，少油炸"],
        texts: ["可选择原味燕麦、全麦面包与低脂原味奶或无糖豆浆；减少奶油糕点和高糖饮料。", "可选择全谷物主食、鱼或豆制品和蔬菜；减少肥肉、加工肉和油炸食品，烹调油适量。", "可选择杂粮、蔬菜和豆制品，采用蒸、煮、炖等做法；减少黄油、肥肉及油炸夜宵。"]
      },
      obesity: {
        label: "肥胖", focus: "控制份量、增加饱腹感、保持可持续的饮食习惯",
        titles: ["早餐：蛋白加纤维，规律吃早餐", "午餐：蔬菜优先，注意份量", "晚餐：适量均衡，减少夜宵"],
        texts: ["可选择全麦主食、鸡蛋或无糖豆浆，搭配蔬菜或适量水果；减少含糖饮料和高热量糕点。", "可选择较多蔬菜、适量杂粮饭和鱼禽或豆腐；注意份量与烹调油，慢慢吃，避免过量。", "保留适量主食、优质蛋白和蔬菜，减少浓酱、油炸食品及高热量夜宵，不采用极端节食。"]
      }
    };
    const subtype = p.audience === "cardio" ? subtypePlans[p.cardioSubtype] : null;
    if (subtype) {
      [breakfastTitle, lunchTitle, dinnerTitle] = subtype.titles.map(title => title + " · " + subtype.label);
      [breakfastText, lunchText, dinnerText] = subtype.texts;
      breakfastText += " 以下为一般饮食参考，具体份量按医生或营养师的个人方案安排。";
    }

    if (isRenal) {
      breakfastTitle = "钾：可能的食材来源";
      lunchTitle = "磷与蛋白质：成分提示";
      dinnerTitle = "钠与液体：成分提示";
      [breakfastText, lunchText, dinnerText] = renalIngredientNotices(meal, p.renalStatus);
    }

    // 健康目标联动
    if (!isRenal && p.goal === "loss" && p.audience !== "youth") {
      breakfastText += " 当前目标为体重管理，注意总量和含糖饮料摄入。";
      lunchText += " 主食适量，优先高纤维食物。";
      dinnerText += " 晚餐避免过量和夜间高热量加餐。";
    } else if (!isRenal && p.goal === "gain" && (subtype || p.audience === "youth" || p.age < 18)) {
      breakfastText += " 已选择增肌目标，请结合个人健康管理方案安排能量和蛋白质。";
    } else if (!isRenal && p.goal === "gain") {
      breakfastText += ` 当前目标为增肌塑形，今日蛋白质参考约 ${proteinGoal} g。`;
      lunchText += " 可适量增加优质蛋白和主食。";
      dinnerText += " 运动后注意补充蛋白质和适量碳水。";
    }

    // 活动水平和步数
    const effectiveActivity = getEffectiveActivity(p.activity, p.steps);
    if (!isRenal && effectiveActivity.ratio < 0.9) {
      lunchText += " 今天活动量偏少，午餐注意份量，减少油炸和高糖饮料。";
      dinnerText += " 晚餐建议不过量，饭后可进行适量步行。";
    } else if (!isRenal && effectiveActivity.ratio >= 1.0) {
      lunchText += subtype ? " 今天活动量较大，请在个人饮食方案内安排主食与蛋白质份量。" : " 今天活动量较大，可适当增加主食和优质蛋白。";
      dinnerText += " 注意补水，并根据运动量合理补充能量。";
    }

    // 身体参数反馈
    if (!isRenal) breakfastText += ` 系统已根据 ${genderLabel}、${p.age}岁、${p.height}cm、${p.weight}kg 的输入重新计算全天营养参考。`;

    // 食物识别结果影响下一餐
    const protein = Number(n.protein) || 0;
    const carbs = Number(n.carbs) || 0;
    const fat = Number(n.fat) || 0;
    const calories = Number(n.calories) || 0;

    if (calories > 0 && isRenal) {
      dinnerText += " 整餐营养估算不能用于推算钠、钾、磷含量或判定是否适合个人食用。";
    } else if (calories > 0 && subtype) {
      if (fat >= 30) dinnerText += " 本次餐食估算脂肪较高，下一餐减少油炸、肥肉和浓酱。";
      if (protein < 20) lunchText += " 本次餐食估算蛋白质偏少，下一餐在个人饮食方案内搭配蛋、鱼或豆制品。";
      if (protein >= 30) lunchText += " 本次餐食已有一定蛋白质，下一餐注意蔬菜和主食的均衡。";
      if (/蔬菜|沙拉/.test(category)) lunchText += " 本次餐食以蔬菜为主时，注意同时搭配适量主食和蛋白质来源。";
      if (/饮品|咖啡|奶茶/.test(category)) dinnerText += " 饮品不能代替正餐，注意含糖饮料的摄入。";
    } else if (calories > 0) {
      if (fat >= 30) {
        dinnerTitle = "晚餐：本餐脂肪偏高，下一餐清淡一点";
        dinnerText = p.audience === "cardio"
          ? "本餐脂肪偏高。下一餐建议减少油炸、肥肉和浓酱，多选蔬菜、鱼类和豆制品。"
          : "本餐脂肪偏高。下一餐减少油炸、肥肉和浓酱，多选蔬菜、鱼虾或清淡做法。";
      }

      if (protein < 20) {
        lunchTitle = "午餐：本餐蛋白质偏少，下一餐补一补";
        lunchText = "下一餐可增加鸡蛋、牛奶、鱼虾、瘦肉或豆制品。";
      } else if (protein >= 30) {
        lunchTitle = "午餐：本餐蛋白质较充足";
        lunchText = "下一餐可以增加蔬菜和适量主食，让整体搭配更均衡。";
      }

      if (/蔬菜|沙拉/.test(category)) {
        lunchTitle = "午餐：蔬菜丰富，再补一点蛋白";
        lunchText = "可增加鸡蛋、豆制品、鱼虾或瘦肉，让这一餐更完整。";
      }

      if (/饮品|咖啡|奶茶/.test(category)) {
        dinnerTitle = "晚餐：饮品不能代替正餐";
        dinnerText = p.audience === "cardio"
          ? "注意饮品中的糖分和能量，正餐仍应以蔬菜、全谷物和优质蛋白为主。"
          : "注意饮品中的糖和能量，正餐仍要保证主食、蛋白质和蔬菜。";
      }
    }

    const proteinStatus = proteinGoal > 0
      ? "全天蛋白质参考目标约 " + proteinGoal + " g，请结合三餐安排。"
      : "蛋白质目标待按个人方案设定，不沿用普通成人的自动估算。";
    if (!isRenal) lunchText += " " + proteinStatus;
    $("recommendHeading").textContent = isRenal ? "食材成分提示" : "个性化推荐";
    $("recommendSubtitle").textContent = isRenal
      ? "根据识别食材名称提示可能相关的成分，不提供饮食处方，也不判断含量、超标或能否食用。"
      : "三餐随身体信息、健康目标、活动水平、步数、推荐对象及识别结果更新。";
    $("breakfastLabel").textContent = isRenal ? "钾提示" : "早餐";
    $("lunchLabel").textContent = isRenal ? "磷与蛋白质提示" : "午餐";
    $("dinnerLabel").textContent = isRenal ? "钠与液体提示" : "晚餐";

    $("breakfastTitle").textContent = breakfastTitle;
    $("breakfastText").textContent = breakfastText;
    $("lunchTitle").textContent = lunchTitle;
    $("lunchText").textContent = lunchText;
    $("dinnerTitle").textContent = dinnerTitle;
    $("dinnerText").textContent = dinnerText;

    const goalLabel =
      p.goal === "loss" ? "科学减脂" :
      p.goal === "gain" ? "增肌塑形" : "保持健康";

    const mealLabel = latestMeal && latestMeal.foodCategory
      ? `；本餐：${latestMeal.foodCategory}`
      : "";

    $("recommendReason").textContent = isRenal
      ? "以上是食材名称匹配得到的可能来源提示，不是成分检测。实际含量取决于食材种类、份量、配料及烹饪方式；不能据此判断肾功能受损或食物有害。"
      : (subtype ? `健康细分：${subtype.label}；推荐重点：${subtype.focus}；` : "") + (reasonText || `推荐对象：${audienceLabel}；${genderLabel}，${p.age}岁，${p.height}cm，${p.weight}kg；${goalLabel}；今日${Math.round(p.steps).toLocaleString("zh-CN")}步${mealLabel}。`);
  }

  function refreshHealthAndRecommendations(reasonText) {
    const isCardio = $("audience").value === "cardio";
    const isRenal = $("audience").value === "renal";
    $("renalStatusField").hidden = !isRenal;
    $("renalStatus").disabled = !isRenal;
    $("cardioSubtypeField").hidden = !isCardio;
    $("cardioSubtype").disabled = !isCardio;
    const gender = $("gender").value;
    const age = +$("age").value;
    const height = +$("height").value;
    const weight = +$("weight").value;
    const factor = +$("activity").value;
    const goal = $("goal").value;
    const steps = Math.max(0, +$("steps").value || 0);

    const bmr = gender === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

    const calories = Math.max(
      1200,
      Math.round((bmr * factor + (goal === "loss" ? -300 : goal === "gain" ? 250 : 0)) / 10) * 10
    );

    $("calorieGoal").textContent = isRenal ? "待设定" : calories;
    const proteinTier = getEffectiveActivity(factor, steps);
    const audience = $("audience").value;
    const goalExtra = goal === "gain" ? 0.4 : goal === "loss" ? 0.2 : 0;
    // Simplified audience tiers for a general demonstration, not prescriptions.
    const isOlder = audience === "older" || age >= 65;
    const audienceFloor = audience === "sports" ? 1.2 : isOlder ? 1.0 : 0.8;
    const proteinCeiling = isOlder && audience !== "sports" ? 1.5 : 2.0;
    const proteinRatio = Math.min(proteinCeiling, Math.round((Math.max(proteinTier.ratio, audienceFloor) + goalExtra) * 10) / 10);
    const audienceNames = { general: "普通人群", youth: "儿童青少年", older: "老年人", sports: "运动人群", cardio: "心血管健康关注人群", renal: "肾功能不全" };
    const subtypeNames = { general: "一般健康关注", diabetes: "糖尿病", hypertension: "高血压", hyperlipidemia: "高血脂", obesity: "肥胖" };
    const contextKey = proteinContextKey();
    const renalNames = { unknown: "肾功能不全（状态待确认）", nondialysis: "肾功能不全（未透析）", dialysis: "肾功能不全（透析）" };
    const contextName = isRenal ? renalNames[$("renalStatus").value] : isCardio ? subtypeNames[$("cardioSubtype").value] : "儿童青少年";
    $("personalProteinField").hidden = !contextKey;
    $("personalProtein").disabled = !contextKey;
    $("personalProteinLabel").textContent = contextKey ? contextName + "：个人方案蛋白目标（g/天）" : "个人方案蛋白目标（g/天）";
    $("personalProtein").value = contextKey ? personalProteinTargets[contextKey] || "" : "";
    const target = contextKey ? Number(personalProteinTargets[contextKey]) : Math.round(weight * proteinRatio);
    const hasTarget = Number.isFinite(target) && target > 0;
    $("proteinGoal").textContent = hasTarget ? target : "待设定";
    $("proteinBasis").textContent = contextKey
      ? contextName + (hasTarget ? " · 个人方案" : " · 请填写个人方案目标")
      : (isOlder && audience === "general" ? "老年成人参考" : audienceNames[audience]) + " · " + proteinTier.label;
    $("proteinReference").textContent = contextKey
      ? contextName + (hasTarget ? "：使用填写的个人方案目标 " + target + " g/天。" : "：尚未设置个人蛋白目标，请按医生或营养师的个人方案填写。") + " 切换对象或细分类型会切换各自目标；个人方案优先，不随步数、活动或增肌目标自动加量。"
      : "今日蛋白质参考约 " + target + " g。普通成年男性每日参考约65 g、女性约55 g，个人目标会随体重、活动水平、今日步数和健康目标调整。步数分档仅作一般估算参考。肾病或肾功能异常者需由医生或营养师制定目标，不直接套用一般估算。";
    $("healthScore").textContent = isRenal ? "--" : Math.min(
      95,
      Math.max(70, Math.round(88 - Math.abs(weight / ((height / 100) ** 2) - 22)))
    );
    $("stepOverview").textContent = Math.round(steps).toLocaleString("zh-CN");
    $("overviewStatus").textContent = isRenal ? "按个人方案管理" : "状态良好";
    $("overviewTitle").textContent = isRenal ? "肾病饮食需个体化安排" : "饮食结构均衡";
    $("overviewTip").textContent = isRenal ? "请结合分期、化验结果及治疗方案安排饮食。" : "继续保持蔬菜与优质蛋白摄入。";

    updatePersonalizedRecommendations(
      reasonText || `已根据身体信息、健康目标和今日 ${Math.round(steps).toLocaleString("zh-CN")} 步实时更新推荐。`
    );
  }

  ["input", "change"].forEach((eventName) => {
    $("personalProtein").addEventListener(eventName, () => {
      const key = proteinContextKey();
      if (!key) return;
      const value = Number($("personalProtein").value);
      personalProteinTargets[key] = Number.isFinite(value) && value > 0 ? String(value) : "";
      refreshHealthAndRecommendations();
    });
  });

  // 身体与目标任意项目改变时，立即更新健康指标和三餐推荐。
  ["gender", "age", "height", "weight", "goal", "activity", "steps", "audience", "cardioSubtype", "renalStatus"].forEach((id) => {
    const el = $(id);
    ["input", "change"].forEach((eventName) => {
      el.addEventListener(eventName, () => {
        refreshHealthAndRecommendations();
      });
    });
  });


  function selectFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setStatus("请选择图片文件。", true);
    if (file.size > 8 * 1024 * 1024) return setStatus("图片不能超过 8MB。", true);
    latestMeal = null;
    $("resultPanel").hidden = true;
    updatePersonalizedRecommendations("新照片尚未识别，原识别结果已清除。");
    selectedFile = file; $("preview").src = URL.createObjectURL(file); $("preview").hidden = false; $("uploadPrompt").hidden = true; $("recognizeButton").disabled = false; setStatus("照片已就绪，点击“开始识别”。");
  }
  $("chooseButton").addEventListener("click", () => $("foodUpload").click());
  $("foodUpload").addEventListener("change", (event) => selectFile(event.target.files[0]));
  $("dropZone").addEventListener("click", () => $("foodUpload").click());
  $("dropZone").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("foodUpload").click(); });
  ["dragenter", "dragover"].forEach((name) => $("dropZone").addEventListener(name, (e) => { e.preventDefault(); $("dropZone").classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => $("dropZone").addEventListener(name, (e) => { e.preventDefault(); $("dropZone").classList.remove("dragging"); }));
  $("dropZone").addEventListener("drop", (e) => selectFile(e.dataTransfer.files[0]));
  function setStatus(text, error) { $("recognitionStatus").textContent = text; $("recognitionStatus").classList.toggle("error", !!error); }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("手机无法读取这张照片，请改选 JPG 或 PNG 图片")); };
      image.src = objectUrl;
    });
  }
  async function prepareImage(file) {
    const image = await loadImage(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("当前浏览器无法处理照片");
    context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }
  async function wakeService() {
    const healthUrl = new URL(API); healthUrl.pathname = "/health"; healthUrl.search = "";
    try { await fetch(healthUrl, { method: "GET", cache: "no-store" }); } catch { /* POST 会给出最终结果 */ }
  }
  function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 10) / 10 : fallback; }
  function scorePercent(value) { const n = number(value); return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n)); }
  function escapeHtml(value) { const el = document.createElement("span"); el.textContent = String(value); return el.innerHTML; }
  function displayResult(data) {
    const labels = window.AIYingBaoLabels;
    $("foodName").textContent = labels.normalizeCategory(data.foodCategory);
    $("confidenceBadge").textContent = `可信度 ${scorePercent(data.confidence).toFixed(1)}%`;
    const ingredients = Array.isArray(data.ingredients) && data.ingredients.length ? data.ingredients.slice(0, 8) : ["食材待确认"];
    $("ingredients").innerHTML = ingredients.map((x) => `<span>${escapeHtml(x)}</span>`).join("");
    const n = data.nutrition || {}; $("calories").textContent = number(n.calories, "--"); $("protein").textContent = number(n.protein, "--"); $("carbs").textContent = number(n.carbs, "--"); $("fat").textContent = number(n.fat, "--");
    const items = Array.isArray(data.top5) ? data.top5.slice(0, 5) : [];
    $("top5").innerHTML = (items.length ? items : [{ name: data.foodCategory, score: data.confidence }]).map((item) => { const p = scorePercent(item.score); return `<li><div><span>${escapeHtml(labels.translateTop5(item.name))}</span><b>${p.toFixed(1)}%</b></div><i><em style="width:${p}%"></em></i></li>`; }).join("");
    $("resultPanel").hidden = false;
    latestMeal = {
      foodCategory: data.foodCategory || "",
      ingredients: Array.isArray(data.ingredients) ? data.ingredients.filter(x => typeof x === "string") : [],
      nutrition: {
        calories: number(n.calories, 0),
        protein: number(n.protein, 0),
        carbs: number(n.carbs, 0),
        fat: number(n.fat, 0)
      }
    };
    updatePersonalizedRecommendations("已结合本次食物识别结果自动更新个性化推荐。");
  }
  refreshHealthAndRecommendations();

  $("recognizeButton").addEventListener("click", async () => {
    if (!selectedFile) return;
    const button = $("recognizeButton"); button.disabled = true; button.textContent = "AI识别中…"; setStatus("正在压缩照片并连接识别服务，首次唤醒可能需要约一分钟。");
    try {
      const imageDataUrl = await prepareImage(selectedFile);
      await wakeService();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ imageDataUrl }), signal: controller.signal });
      } finally { clearTimeout(timer); }
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `服务响应异常（${response.status}）`);
      displayResult(data); setStatus("识别完成：结果已按粗粒度餐食类别展示。");
    } catch (error) {
      const message = error.name === "AbortError" ? "识别等待超过 2 分钟，请稍后重试" : error.message === "Load failed" || error.message === "Failed to fetch" ? "网络连接中断，请关闭 VPN/内容拦截后切换 Wi-Fi 或蜂窝网络重试" : error.message;
      setStatus(`识别失败：${message}。`, true);
    }
    finally { button.disabled = false; button.textContent = "重新识别"; }
  });
})();
