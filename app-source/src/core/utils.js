// 取余函数（保证结果为正）
export function mod(n, m) {
    return ((n % m) + m) % m;
}